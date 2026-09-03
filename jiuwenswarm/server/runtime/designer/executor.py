# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""Designer graph executor — wave scheduler with sync-edge barriers."""

from __future__ import annotations

import asyncio
import logging
from copy import deepcopy
from dataclasses import dataclass
from typing import AsyncIterator, Protocol

from jiuwenswarm.common.schema.designer_graph import (
    DesignerExecutionGraph,
    DesignerExecutionRun,
    DesignerGraphNode,
    DesignerNodeState,
    NODE_STATUS_CANCELLED,
    NODE_STATUS_COMPLETED,
    NODE_STATUS_FAILED,
    NODE_STATUS_PENDING,
    NODE_STATUS_RUNNING,
    RUN_STATUS_CANCELLED,
    RUN_STATUS_COMPLETED,
    RUN_STATUS_DRAFT,
    RUN_STATUS_FAILED,
    RUN_STATUS_PAUSED,
    RUN_STATUS_RUNNING,
    data_predecessors,
    initial_node_states,
    new_run_id,
    sync_groups,
    utc_now_ms,
)
from jiuwenswarm.common.schema.message import EventType
from jiuwenswarm.server.runtime.designer.a2a_collab import collaborate_ready_wave
from jiuwenswarm.server.runtime.designer.graph_store import DesignerGraphStore
from jiuwenswarm.server.runtime.designer.handlers import (
    NodeExecutionContext,
    get_node_handler,
)

logger = logging.getLogger(__name__)


class RunUpdateCallback(Protocol):
    def __call__(
        self,
        run: DesignerExecutionRun,
        node_id: str | None = None,
    ) -> None: ...

_MOCK_NODE_DELAY_SECONDS = 0.35
_TERMINAL_NODE_STATUSES = {
    NODE_STATUS_COMPLETED,
    NODE_STATUS_FAILED,
    NODE_STATUS_CANCELLED,
}


@dataclass(frozen=True)
class NodeEvent:
    event: str
    run: DesignerExecutionRun
    node_id: str | None = None


class GraphExecutor:
    """Wave scheduler: data edges are dependencies, sync edges are barriers."""

    def __init__(self, store: DesignerGraphStore | None = None) -> None:
        self._store = store or DesignerGraphStore()
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._pause_flags: dict[str, asyncio.Event] = {}
        self._cancel_flags: dict[str, asyncio.Event] = {}
        self._state_locks: dict[str, asyncio.Lock] = {}

    def create_run(self, graph: DesignerExecutionGraph) -> DesignerExecutionRun:
        now = utc_now_ms()
        run: DesignerExecutionRun = {
            "schema_version": "designer-execution-run.v1",
            "run_id": new_run_id(),
            "graph_id": graph["graph_id"],
            "project_id": graph["project_id"],
            "status": RUN_STATUS_DRAFT,
            "node_states": initial_node_states(graph),
            "current_node_ids": [],
            "created_at": now,
            "updated_at": now,
        }
        return self._store.save_run(run)

    def create_rerun(
        self,
        graph: DesignerExecutionGraph,
        *,
        source_run: DesignerExecutionRun,
        node_id: str,
    ) -> DesignerExecutionRun:
        """Copy a finished run and reset one node so only that node executes again."""
        node_ids = {node["id"] for node in graph.get("nodes", [])}
        if node_id not in node_ids:
            raise KeyError(f"node not found: {node_id}")
        incoming = data_predecessors(graph)
        groups = sync_groups(graph)
        source_states = source_run.get("node_states") or {}
        for pred in incoming.get(node_id, []):
            members = groups.get(pred, frozenset({pred}))
            for member in members:
                if (source_states.get(member) or {}).get("status") != NODE_STATUS_COMPLETED:
                    raise ValueError(f"upstream not ready: {member}")
        now = utc_now_ms()
        states = deepcopy(source_states)
        for node in graph.get("nodes", []):
            states.setdefault(node["id"], {"status": NODE_STATUS_PENDING})
        previous = states.get(node_id) or {}
        kept_ref = previous.get("output_ref") if _usable_ref(previous.get("output_ref")) else None
        kept_refs = [
            ref for ref in (previous.get("output_refs") or []) if _usable_ref(ref)
        ]
        if kept_ref is not None and not kept_refs:
            kept_refs = [kept_ref]
        states[node_id] = {
            "status": NODE_STATUS_PENDING,
            "started_at": None,
            "completed_at": None,
            "output_ref": kept_ref,
            "output_refs": kept_refs,
            "error": None,
            "blocked_by": [],
        }
        run: DesignerExecutionRun = {
            "schema_version": "designer-execution-run.v1",
            "run_id": new_run_id(),
            "graph_id": graph["graph_id"],
            "project_id": graph["project_id"],
            "status": RUN_STATUS_DRAFT,
            "node_states": states,
            "current_node_ids": [],
            "created_at": now,
            "updated_at": now,
        }
        return self._store.save_run(run)

    async def start_run(
        self,
        run_id: str,
        *,
        on_update: RunUpdateCallback | None = None,
    ) -> DesignerExecutionRun:
        run = self._require_run(run_id)
        if run["status"] in {RUN_STATUS_RUNNING, RUN_STATUS_COMPLETED}:
            return run
        graph = self._require_graph(run["graph_id"])
        run["status"] = RUN_STATUS_RUNNING
        run["updated_at"] = utc_now_ms()
        run = self._store.save_run(run)
        self._pause_flags[run_id] = asyncio.Event()
        self._pause_flags[run_id].set()
        self._cancel_flags[run_id] = asyncio.Event()
        self._state_locks[run_id] = asyncio.Lock()
        task = asyncio.create_task(
            self._execute_run(graph, run, on_update=on_update),
            name=f"designer-run-{run_id}",
        )
        self._tasks[run_id] = task
        return run

    async def run(self, graph: DesignerExecutionGraph, run_id: str) -> AsyncIterator[NodeEvent]:
        """Drive a run and yield node/run events as they happen."""
        queue: asyncio.Queue[NodeEvent] = asyncio.Queue()

        def on_update(updated: DesignerExecutionRun, node_id: str | None = None) -> None:
            event = (
                EventType.DESIGNER_NODE_UPDATED.value
                if node_id
                else EventType.DESIGNER_RUN_UPDATED.value
            )
            queue.put_nowait(
                NodeEvent(
                    event=event,
                    run=deepcopy(updated),
                    node_id=node_id,
                )
            )

        existing = self._tasks.get(run_id)
        if existing is None or existing.done():
            started = await self.start_run(run_id, on_update=on_update)
            queue.put_nowait(
                NodeEvent(event=EventType.DESIGNER_RUN_UPDATED.value, run=deepcopy(started))
            )
        task = self._tasks.get(run_id)
        if task is None:
            return
        while True:
            if task.done() and queue.empty():
                break
            try:
                event = await asyncio.wait_for(queue.get(), timeout=0.05)
            except TimeoutError:
                continue
            yield event
        await task

    def pause_run(self, run_id: str) -> DesignerExecutionRun:
        run = self._require_run(run_id)
        pause_flag = self._pause_flags.get(run_id)
        if pause_flag is not None:
            pause_flag.clear()
        run["status"] = RUN_STATUS_PAUSED
        run["updated_at"] = utc_now_ms()
        return self._store.save_run(run)

    def choose_output(
        self,
        run_id: str,
        node_id: str,
        choice: str,
    ) -> DesignerExecutionRun:
        """Keep the original output or promote the regenerated candidate."""
        run = self._require_run(run_id)
        states = run.setdefault("node_states", {})
        state = states.get(node_id)
        if not isinstance(state, dict):
            raise KeyError(f"node not found: {node_id}")
        if state.get("status") == NODE_STATUS_RUNNING:
            raise ValueError("node is still running")
        decided = str(choice or "").strip()
        if decided not in {"original", "new"}:
            raise ValueError("choice must be original or new")
        candidate = state.get("candidate_output_ref")
        if not _usable_ref(candidate):
            raise ValueError("no pending revision")
        if decided == "new":
            refs = [ref for ref in (state.get("candidate_output_refs") or []) if _usable_ref(ref)]
            state["output_ref"] = candidate
            state["output_refs"] = refs or [candidate]
        state["candidate_output_ref"] = None
        state["candidate_output_refs"] = []
        run["updated_at"] = utc_now_ms()
        return self._store.save_run(run)

    def cancel_run(self, run_id: str) -> DesignerExecutionRun:
        run = self._require_run(run_id)
        cancel_flag = self._cancel_flags.get(run_id)
        if cancel_flag is not None:
            cancel_flag.set()
        task = self._tasks.pop(run_id, None)
        if task is not None and not task.done():
            task.cancel()
        for node_id, state in run.get("node_states", {}).items():
            if state.get("status") in {NODE_STATUS_PENDING, NODE_STATUS_RUNNING}:
                state["status"] = NODE_STATUS_CANCELLED
        run["status"] = RUN_STATUS_CANCELLED
        run["current_node_ids"] = []
        run["updated_at"] = utc_now_ms()
        return self._store.save_run(run)

    def _require_run(self, run_id: str) -> DesignerExecutionRun:
        run = self._store.get_run(run_id)
        if run is None:
            raise KeyError(f"designer run not found: {run_id}")
        return run

    def _require_graph(self, graph_id: str) -> DesignerExecutionGraph:
        graph = self._store.get_graph(graph_id)
        if graph is None:
            raise KeyError(f"designer graph not found: {graph_id}")
        return graph

    async def _execute_run(
        self,
        graph: DesignerExecutionGraph,
        run: DesignerExecutionRun,
        *,
        on_update: RunUpdateCallback | None,
    ) -> None:
        run_id = run["run_id"]
        remaining = {
            node["id"]
            for node in graph.get("nodes", [])
            if (run.get("node_states") or {}).get(node["id"], {}).get("status")
            not in _TERMINAL_NODE_STATUSES
        }
        incoming = data_predecessors(graph)
        groups = sync_groups(graph)
        try:
            while remaining:
                await self._await_pause(run_id)
                if self._is_cancelled(run_id):
                    break
                ready_ids = [
                    node_id
                    for node_id in remaining
                    if _is_ready(node_id, run, incoming, groups)
                ]
                if not ready_ids:
                    run["status"] = RUN_STATUS_FAILED
                    run["updated_at"] = utc_now_ms()
                    self._publish(run, on_update)
                    self._store.save_run(run)
                    return
                run["current_node_ids"] = list(ready_ids)
                await collaborate_ready_wave(graph, run, ready_ids)
                await asyncio.gather(
                    *(
                        self._run_single_node(
                            graph,
                            run,
                            _node_by_id(graph, node_id),
                            on_update=on_update,
                        )
                        for node_id in ready_ids
                    )
                )
                remaining -= {
                    node_id
                    for node_id in ready_ids
                    if run["node_states"].get(node_id, {}).get("status") in _TERMINAL_NODE_STATUSES
                }
                if run.get("status") == RUN_STATUS_FAILED or self._is_cancelled(run_id):
                    break
            if self._is_cancelled(run_id):
                return
            statuses = {state.get("status") for state in run["node_states"].values()}
            if NODE_STATUS_FAILED in statuses or remaining:
                run["status"] = RUN_STATUS_FAILED
            else:
                run["status"] = RUN_STATUS_COMPLETED
            run["current_node_ids"] = []
            run["updated_at"] = utc_now_ms()
            self._publish(run, on_update)
            self._store.save_run(run)
        except asyncio.CancelledError:
            run = self.cancel_run(run_id)
            self._publish(run, on_update)
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("Designer run %s failed: %s", run_id, exc)
            run["status"] = RUN_STATUS_FAILED
            run["updated_at"] = utc_now_ms()
            self._publish(run, on_update)
            self._store.save_run(run)
        finally:
            self._tasks.pop(run_id, None)
            self._pause_flags.pop(run_id, None)
            self._cancel_flags.pop(run_id, None)
            self._state_locks.pop(run_id, None)

    async def _run_single_node(
        self,
        graph: DesignerExecutionGraph,
        run: DesignerExecutionRun,
        node: DesignerGraphNode,
        *,
        on_update: RunUpdateCallback | None,
    ) -> None:
        node_id = node["id"]
        started_at = utc_now_ms()
        blocked_by = list(sync_groups(graph).get(node_id, frozenset()) - {node_id})
        lock = self._state_locks.setdefault(run["run_id"], asyncio.Lock())
        async with lock:
            self._set_node_state(
                run,
                node_id,
                {
                    "status": NODE_STATUS_RUNNING,
                    "started_at": started_at,
                    "error": None,
                    "blocked_by": blocked_by,
                },
            )
            self._publish(run, on_update, node_id)
        try:
            handler = get_node_handler(node)
            ctx = NodeExecutionContext(
                graph=graph,
                run_id=run["run_id"],
                node_id=node_id,
                run=run,
            )
            result = await handler.execute(node, ctx)
            if _MOCK_NODE_DELAY_SECONDS:
                await asyncio.sleep(_MOCK_NODE_DELAY_SECONDS)
            if self._is_cancelled(run["run_id"]):
                return
            refs = [ref for ref in (result.output_refs or []) if ref]
            primary = result.output_ref or (refs[0] if refs else None)
            if primary is not None and not refs:
                refs = [primary]
            current = (run.get("node_states") or {}).get(node_id) or {}
            kept = current.get("output_ref") if _usable_ref(current.get("output_ref")) else None
            kept_refs = [ref for ref in (current.get("output_refs") or []) if _usable_ref(ref)]
            if kept is not None and not kept_refs:
                kept_refs = [kept]
            incoming_uri = str((primary or {}).get("uri") or "") if primary else ""
            kept_uri = str((kept or {}).get("uri") or "") if kept else ""
            pending = bool(kept and primary and incoming_uri and incoming_uri != kept_uri)
            async with lock:
                self._set_node_state(
                    run,
                    node_id,
                    {
                        "status": NODE_STATUS_COMPLETED,
                        "started_at": started_at,
                        "completed_at": utc_now_ms(),
                        "output_ref": kept if pending else primary,
                        "output_refs": kept_refs if pending else refs,
                        "candidate_output_ref": primary if pending else None,
                        "candidate_output_refs": refs if pending else [],
                        "error": None,
                        "blocked_by": [],
                    },
                )
        except Exception as exc:  # noqa: BLE001
            async with lock:
                self._set_node_state(
                    run,
                    node_id,
                    {
                        "status": NODE_STATUS_FAILED,
                        "started_at": started_at,
                        "completed_at": utc_now_ms(),
                        "error": str(exc),
                    },
                )
                run["status"] = RUN_STATUS_FAILED
        finally:
            async with lock:
                run["updated_at"] = utc_now_ms()
                self._publish(run, on_update, node_id)
                self._store.save_run(run)

    async def _await_pause(self, run_id: str) -> None:
        pause_flag = self._pause_flags.get(run_id)
        if pause_flag is None:
            return
        await pause_flag.wait()

    def _is_cancelled(self, run_id: str) -> bool:
        cancel_flag = self._cancel_flags.get(run_id)
        return cancel_flag is not None and cancel_flag.is_set()

    @staticmethod
    def _set_node_state(
        run: DesignerExecutionRun,
        node_id: str,
        patch: DesignerNodeState,
    ) -> None:
        states = run.setdefault("node_states", {})
        current = dict(states.get(node_id) or {"status": NODE_STATUS_PENDING})
        current.update(patch)
        states[node_id] = current

    @staticmethod
    def _publish(
        run: DesignerExecutionRun,
        on_update: RunUpdateCallback | None,
        node_id: str | None = None,
    ) -> None:
        if on_update is not None:
            on_update(run, node_id)


def _usable_ref(ref: object) -> bool:
    if not isinstance(ref, dict):
        return False
    uri = str(ref.get("uri") or "").strip()
    return bool(uri) and not uri.startswith("designer://")


def _node_by_id(graph: DesignerExecutionGraph, node_id: str) -> DesignerGraphNode:
    for node in graph.get("nodes", []):
        if node.get("id") == node_id:
            return node
    raise KeyError(f"node not found: {node_id}")


def _is_ready(
    node_id: str,
    run: DesignerExecutionRun,
    incoming: dict[str, list[str]],
    groups: dict[str, frozenset[str]],
) -> bool:
    state = run.get("node_states", {}).get(node_id) or {}
    if state.get("status") != NODE_STATUS_PENDING:
        return False
    preds = incoming.get(node_id, [])
    for pred in preds:
        group = groups.get(pred, frozenset({pred}))
        for member in group:
            member_status = (run.get("node_states", {}).get(member) or {}).get("status")
            if member_status != NODE_STATUS_COMPLETED:
                return False
    return True
