# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""Designer execution graph domain schema (canonical Python contract).

Shared between the React Flow frontend, gateway RPC handlers, and the graph
executor.  Frontend mirrors live in
``channels/web/frontend/src/features/designer/executionGraphTypes.ts``;
cross-layer literals are pinned by
``tests/unit_tests/test_designer_execution_graph_contract.py``.
"""

from __future__ import annotations

import secrets
import time
from typing import Any, TypedDict

# ── Schema version ────────────────────────────────────────────────────────────

SCHEMA_VERSION = "designer-execution-graph.v1"
"""Domain graph payload version."""

RUN_SCHEMA_VERSION = "designer-execution-run.v1"
"""Execution run state payload version."""

# ── Node types (modality, contract-pinned) ────────────────────────────────────

NODE_TYPE_TEXT = "text"
NODE_TYPE_TABLE = "table"
NODE_TYPE_IMAGE = "image"
NODE_TYPE_VIDEO = "video"
NODE_TYPE_AUDIO = "audio"

NODE_TYPES: frozenset[str] = frozenset(
    {
        NODE_TYPE_TEXT,
        NODE_TYPE_TABLE,
        NODE_TYPE_IMAGE,
        NODE_TYPE_VIDEO,
        NODE_TYPE_AUDIO,
    }
)

# ── Node roles (handler dispatch; modality type stays on node.type) ───────────

NODE_ROLE_BRIEF = "brief"
NODE_ROLE_CHARACTER_DESIGN = "character_design"
NODE_ROLE_SCENE = "scene"
NODE_ROLE_STORYBOARD = "storyboard"
NODE_ROLE_FRAME = "frame"
NODE_ROLE_CLIP = "clip"

NODE_ROLES: frozenset[str] = frozenset(
    {
        NODE_ROLE_BRIEF,
        NODE_ROLE_CHARACTER_DESIGN,
        NODE_ROLE_SCENE,
        NODE_ROLE_STORYBOARD,
        NODE_ROLE_FRAME,
        NODE_ROLE_CLIP,
    }
)

# ── Node config (role-discriminated; modality stays on node.type) ─────────────

CONFIG_KEY_ROLE = "role"
CONFIG_KEY_PROMPT = "prompt"
CONFIG_KEY_INPUTS = "inputs"
CONFIG_KEY_DELEGATE = "delegate"
CONFIG_KEY_COLLABORATE = "collaborate"

CONFIG_KEYS: frozenset[str] = frozenset(
    {
        CONFIG_KEY_ROLE,
        CONFIG_KEY_PROMPT,
        CONFIG_KEY_INPUTS,
        CONFIG_KEY_DELEGATE,
        CONFIG_KEY_COLLABORATE,
    }
)

CONFIG_DELEGATE_HANDLER = "handler"
CONFIG_DELEGATE_SUBAGENT = "subagent"

CONFIG_DELEGATES: frozenset[str] = frozenset(
    {
        CONFIG_DELEGATE_HANDLER,
        CONFIG_DELEGATE_SUBAGENT,
    }
)

# ── Edge kinds ────────────────────────────────────────────────────────────────

EDGE_KIND_DATA = "data"
EDGE_KIND_SYNC = "sync"

EDGE_KINDS: frozenset[str] = frozenset({EDGE_KIND_DATA, EDGE_KIND_SYNC})

# ── Graph sources ─────────────────────────────────────────────────────────────

GRAPH_SOURCE_PROMPT = "prompt"
GRAPH_SOURCE_MANUAL = "manual"

GRAPH_SOURCES: frozenset[str] = frozenset(
    {
        GRAPH_SOURCE_PROMPT,
        GRAPH_SOURCE_MANUAL,
    }
)

# ── Node / run statuses ───────────────────────────────────────────────────────

NODE_STATUS_PENDING = "pending"
NODE_STATUS_RUNNING = "running"
NODE_STATUS_COMPLETED = "completed"
NODE_STATUS_FAILED = "failed"
NODE_STATUS_CANCELLED = "cancelled"

NODE_STATUSES: frozenset[str] = frozenset(
    {
        NODE_STATUS_PENDING,
        NODE_STATUS_RUNNING,
        NODE_STATUS_COMPLETED,
        NODE_STATUS_FAILED,
        NODE_STATUS_CANCELLED,
    }
)

RUN_STATUS_DRAFT = "draft"
RUN_STATUS_RUNNING = "running"
RUN_STATUS_PAUSED = "paused"
RUN_STATUS_COMPLETED = "completed"
RUN_STATUS_FAILED = "failed"
RUN_STATUS_CANCELLED = "cancelled"

RUN_STATUSES: frozenset[str] = frozenset(
    {
        RUN_STATUS_DRAFT,
        RUN_STATUS_RUNNING,
        RUN_STATUS_PAUSED,
        RUN_STATUS_COMPLETED,
        RUN_STATUS_FAILED,
        RUN_STATUS_CANCELLED,
    }
)

# ── ID helpers ────────────────────────────────────────────────────────────────

_GRAPH_ID_PREFIX = "graph_"
_RUN_ID_PREFIX = "run_"
_ID_HEX_LEN = 8


def new_graph_id() -> str:
    return f"{_GRAPH_ID_PREFIX}{secrets.token_hex(_ID_HEX_LEN)}"


def new_run_id() -> str:
    return f"{_RUN_ID_PREFIX}{secrets.token_hex(_ID_HEX_LEN)}"


def utc_now_ms() -> int:
    return int(time.time() * 1000)


# ── Typed payloads ──────────────────────────────────────────────────────────────


class AssetRef(TypedDict, total=False):
    kind: str
    uri: str
    mime_type: str
    label: str


class NodeLayout(TypedDict, total=False):
    x: float
    y: float
    width: float
    height: float


class DesignerNodeConfig(TypedDict, total=False):
    """Typed node config. ``role`` is the handler discriminator."""

    role: str
    prompt: str
    inputs: list[str]
    delegate: str
    collaborate: bool


class DesignerGraphPatch(TypedDict, total=False):
    title: str
    description: str
    upsert_nodes: list[Any]
    upsert_edges: list[Any]
    remove_node_ids: list[str]
    remove_edge_ids: list[str]


class DesignerGraphNode(TypedDict, total=False):
    id: str
    type: str
    label: str
    config: DesignerNodeConfig
    layout: NodeLayout
    output_ref: AssetRef | None


class DesignerGraphEdge(TypedDict, total=False):
    id: str
    source: str
    target: str
    kind: str
    label: str


class DesignerExecutionGraph(TypedDict, total=False):
    schema_version: str
    graph_id: str
    project_id: str
    title: str
    description: str
    source: str
    nodes: list[DesignerGraphNode]
    edges: list[DesignerGraphEdge]
    metadata: dict[str, Any]
    created_at: int
    updated_at: int


class DesignerNodeState(TypedDict, total=False):
    status: str
    started_at: int | None
    completed_at: int | None
    output_ref: AssetRef | None
    output_refs: list[AssetRef]
    candidate_output_ref: AssetRef | None
    candidate_output_refs: list[AssetRef]
    error: str | None
    blocked_by: list[str]


class DesignerExecutionRun(TypedDict, total=False):
    schema_version: str
    run_id: str
    graph_id: str
    project_id: str
    status: str
    node_states: dict[str, DesignerNodeState]
    current_node_ids: list[str]
    created_at: int
    updated_at: int


# ── Validation / normalization ────────────────────────────────────────────────


class DesignerGraphValidationError(ValueError):
    """Raised when an execution graph payload fails schema validation."""


def _require_str(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise DesignerGraphValidationError(f"{field} must be a non-empty string")
    return value.strip()


def normalize_layout(raw: Any) -> NodeLayout:
    layout: NodeLayout = {}
    if not isinstance(raw, dict):
        return layout
    for key in ("x", "y", "width", "height"):
        val = raw.get(key)
        if isinstance(val, (int, float)) and not isinstance(val, bool):
            layout[key] = float(val)  # type: ignore[literal-required]
    return layout


def normalize_asset_ref(raw: Any) -> AssetRef | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise DesignerGraphValidationError("output_ref must be an object")
    kind = raw.get("kind")
    uri = raw.get("uri")
    if not isinstance(kind, str) or not kind.strip():
        raise DesignerGraphValidationError("output_ref.kind must be a non-empty string")
    if not isinstance(uri, str) or not uri.strip():
        raise DesignerGraphValidationError("output_ref.uri must be a non-empty string")
    ref: AssetRef = {"kind": kind.strip(), "uri": uri.strip()}
    mime_type = raw.get("mime_type")
    if isinstance(mime_type, str) and mime_type.strip():
        ref["mime_type"] = mime_type.strip()
    label = raw.get("label")
    if isinstance(label, str) and label.strip():
        ref["label"] = label.strip()
    return ref


def normalize_node_config(raw: Any) -> DesignerNodeConfig:
    """Validate role-discriminated node config; keep unknown keys for forward compat."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise DesignerGraphValidationError("node.config must be an object")
    config: dict[str, Any] = {
        key: value for key, value in raw.items() if key not in CONFIG_KEYS
    }
    role = raw.get(CONFIG_KEY_ROLE)
    if role is not None and not (isinstance(role, str) and not role.strip()):
        if not isinstance(role, str) or not role.strip():
            raise DesignerGraphValidationError("node.config.role must be a non-empty string")
        role = role.strip()
        if role not in NODE_ROLES:
            raise DesignerGraphValidationError(f"unsupported node role: {role!r}")
        config[CONFIG_KEY_ROLE] = role
    prompt = raw.get(CONFIG_KEY_PROMPT)
    if prompt is not None:
        if not isinstance(prompt, str):
            raise DesignerGraphValidationError("node.config.prompt must be a string")
        config[CONFIG_KEY_PROMPT] = prompt
    inputs = raw.get(CONFIG_KEY_INPUTS)
    if inputs is not None:
        if not isinstance(inputs, list) or not all(
            isinstance(item, str) and item.strip() for item in inputs
        ):
            raise DesignerGraphValidationError(
                "node.config.inputs must be a non-empty-string array"
            )
        config[CONFIG_KEY_INPUTS] = [str(item).strip() for item in inputs]
    delegate = raw.get(CONFIG_KEY_DELEGATE)
    if delegate is not None and not (isinstance(delegate, str) and not delegate.strip()):
        if not isinstance(delegate, str) or delegate.strip() not in CONFIG_DELEGATES:
            raise DesignerGraphValidationError(
                "node.config.delegate must be 'handler' or 'subagent'"
            )
        config[CONFIG_KEY_DELEGATE] = delegate.strip()
    collaborate = raw.get(CONFIG_KEY_COLLABORATE)
    if collaborate is not None:
        if not isinstance(collaborate, bool):
            raise DesignerGraphValidationError("node.config.collaborate must be a boolean")
        config[CONFIG_KEY_COLLABORATE] = collaborate
    return config  # type: ignore[return-value]


def normalize_node(raw: Any) -> DesignerGraphNode:
    if not isinstance(raw, dict):
        raise DesignerGraphValidationError("node must be an object")
    node_id = _require_str(raw.get("id"), "node.id")
    node_type = _require_str(raw.get("type"), "node.type")
    if node_type not in NODE_TYPES:
        raise DesignerGraphValidationError(f"unsupported node type: {node_type!r}")
    label = raw.get("label")
    node: DesignerGraphNode = {
        "id": node_id,
        "type": node_type,
        "label": str(label).strip() if isinstance(label, str) and label.strip() else node_id,
        "config": normalize_node_config(raw.get("config")),
        "layout": normalize_layout(raw.get("layout")),
    }
    if "output_ref" in raw:
        node["output_ref"] = normalize_asset_ref(raw.get("output_ref"))
    return node


def normalize_edge(raw: Any) -> DesignerGraphEdge:
    if not isinstance(raw, dict):
        raise DesignerGraphValidationError("edge must be an object")
    edge_id = _require_str(raw.get("id"), "edge.id")
    source = _require_str(raw.get("source"), "edge.source")
    target = _require_str(raw.get("target"), "edge.target")
    kind_raw = raw.get("kind")
    kind = EDGE_KIND_DATA
    if isinstance(kind_raw, str) and kind_raw.strip():
        kind = kind_raw.strip()
    if kind not in EDGE_KINDS:
        raise DesignerGraphValidationError(f"unsupported edge kind: {kind!r}")
    edge: DesignerGraphEdge = {
        "id": edge_id,
        "source": source,
        "target": target,
        "kind": kind,
    }
    label = raw.get("label")
    if isinstance(label, str) and label.strip():
        edge["label"] = label.strip()
    return edge


def normalize_execution_graph(raw: Any) -> DesignerExecutionGraph:
    if not isinstance(raw, dict):
        raise DesignerGraphValidationError("graph must be an object")
    schema_version = _require_str(raw.get("schema_version"), "schema_version")
    if schema_version != SCHEMA_VERSION:
        raise DesignerGraphValidationError(
            f"unsupported schema_version: {schema_version!r} (expected {SCHEMA_VERSION!r})"
        )
    graph_id = _require_str(raw.get("graph_id"), "graph_id")
    project_id = _require_str(raw.get("project_id"), "project_id")
    title = raw.get("title")
    description = raw.get("description")
    source = raw.get("source")
    graph_source = GRAPH_SOURCE_MANUAL
    if isinstance(source, str) and source.strip():
        graph_source = source.strip()
        if graph_source not in GRAPH_SOURCES:
            raise DesignerGraphValidationError(f"unsupported source: {graph_source!r}")
    raw_nodes = raw.get("nodes")
    if not isinstance(raw_nodes, list):
        raise DesignerGraphValidationError("nodes must be an array")
    raw_edges = raw.get("edges")
    if not isinstance(raw_edges, list):
        raise DesignerGraphValidationError("edges must be an array")
    nodes = [normalize_node(item) for item in raw_nodes]
    edges = [normalize_edge(item) for item in raw_edges]
    node_ids = {node["id"] for node in nodes}
    if len(node_ids) != len(nodes):
        raise DesignerGraphValidationError("node ids must be unique")
    for edge in edges:
        if edge["source"] not in node_ids or edge["target"] not in node_ids:
            raise DesignerGraphValidationError(
                f"edge {edge['id']!r} references unknown node id"
            )
    metadata = raw.get("metadata")
    if metadata is not None and not isinstance(metadata, dict):
        raise DesignerGraphValidationError("metadata must be an object")
    now = utc_now_ms()
    created_at = raw.get("created_at")
    updated_at = raw.get("updated_at")
    graph: DesignerExecutionGraph = {
        "schema_version": SCHEMA_VERSION,
        "graph_id": graph_id,
        "project_id": project_id,
        "title": str(title).strip() if isinstance(title, str) and title.strip() else "Untitled",
        "description": str(description).strip() if isinstance(description, str) else "",
        "source": graph_source,
        "nodes": nodes,
        "edges": edges,
        "metadata": dict(metadata) if isinstance(metadata, dict) else {},
        "created_at": int(created_at) if isinstance(created_at, int) else now,
        "updated_at": int(updated_at) if isinstance(updated_at, int) else now,
    }
    return ensure_bootstrap_pipeline(graph)


def _append_unique_edge(
    edges: list[DesignerGraphEdge],
    *,
    edge_id: str,
    source: str,
    target: str,
    kind: str = EDGE_KIND_DATA,
    label: str | None = None,
) -> None:
    if any(edge.get("source") == source and edge.get("target") == target for edge in edges):
        return
    edge: DesignerGraphEdge = {"id": edge_id, "source": source, "target": target, "kind": kind}
    if label:
        edge["label"] = label
    edges.append(edge)


def _append_node_input(graph: DesignerExecutionGraph, node_id: str, input_id: str) -> None:
    for node in graph.get("nodes") or []:
        if node.get("id") != node_id:
            continue
        config = node.setdefault("config", {})
        if not isinstance(config, dict):
            return
        inputs = [str(item) for item in (config.get("inputs") or [])]
        if input_id not in inputs:
            inputs.append(input_id)
            config["inputs"] = inputs
        return


def ensure_bootstrap_pipeline(graph: DesignerExecutionGraph) -> DesignerExecutionGraph:
    """Keep old bootstrap graphs on the current clip / scene / keyframe pipeline."""
    metadata = graph.get("metadata") or {}
    if metadata.get("bootstrap") != "designer.graph.bootstrap.v1":
        return graph
    node_ids = {node["id"] for node in graph.get("nodes") or []}
    edges = graph.setdefault("edges", [])
    if "n_brief" in node_ids and "n_frame" in node_ids and "n_scene" not in node_ids:
        graph.setdefault("nodes", []).append(
            {
                "id": "n_scene",
                "type": NODE_TYPE_IMAGE,
                "label": "场景图",
                "config": {"role": NODE_ROLE_SCENE, "inputs": ["n_brief"]},
                "layout": {"x": 380, "y": 160, "width": 280, "height": 160},
            }
        )
        node_ids.add("n_scene")
    if "n_scene" in node_ids:
        _append_unique_edge(edges, edge_id="e_brief_scene", source="n_brief", target="n_scene")
        _append_unique_edge(edges, edge_id="e_scene_frame", source="n_scene", target="n_frame")
        _append_node_input(graph, "n_frame", "n_scene")
    if "n_scene" in node_ids and "n_storyboard" in node_ids:
        _append_unique_edge(
            edges,
            edge_id="e_scene_storyboard",
            source="n_scene",
            target="n_storyboard",
            kind=EDGE_KIND_SYNC,
            label="对齐",
        )
    if "n_frame" in node_ids and "n_clip" in node_ids:
        _append_unique_edge(edges, edge_id="e_frame_clip", source="n_frame", target="n_clip")
        _append_node_input(graph, "n_clip", "n_frame")
    return graph


def ensure_bootstrap_clip_waits_for_frame(
    graph: DesignerExecutionGraph,
) -> DesignerExecutionGraph:
    """Backward-compatible alias used by older tests."""
    return ensure_bootstrap_pipeline(graph)


def normalize_node_state(raw: Any) -> DesignerNodeState:
    if not isinstance(raw, dict):
        raise DesignerGraphValidationError("node_state must be an object")
    status = _require_str(raw.get("status"), "node_state.status")
    if status not in NODE_STATUSES:
        raise DesignerGraphValidationError(f"unsupported node status: {status!r}")
    state: DesignerNodeState = {"status": status}
    for key in ("started_at", "completed_at"):
        val = raw.get(key)
        if val is None:
            state[key] = None  # type: ignore[literal-required]
        elif isinstance(val, int) and not isinstance(val, bool):
            state[key] = val  # type: ignore[literal-required]
        else:
            raise DesignerGraphValidationError(f"node_state.{key} must be an integer or null")
    if "output_ref" in raw:
        state["output_ref"] = normalize_asset_ref(raw.get("output_ref"))
    if "output_refs" in raw:
        raw_refs = raw.get("output_refs")
        if not isinstance(raw_refs, list):
            raise DesignerGraphValidationError("node_state.output_refs must be an array")
        state["output_refs"] = [
            ref
            for ref in (normalize_asset_ref(item) for item in raw_refs)
            if ref is not None
        ]
    if "candidate_output_ref" in raw:
        state["candidate_output_ref"] = normalize_asset_ref(raw.get("candidate_output_ref"))
    if "candidate_output_refs" in raw:
        raw_candidates = raw.get("candidate_output_refs")
        if not isinstance(raw_candidates, list):
            raise DesignerGraphValidationError("node_state.candidate_output_refs must be an array")
        state["candidate_output_refs"] = [
            ref
            for ref in (normalize_asset_ref(item) for item in raw_candidates)
            if ref is not None
        ]
    error = raw.get("error")
    if isinstance(error, str):
        state["error"] = error
    blocked_by = raw.get("blocked_by")
    if blocked_by is not None:
        if not isinstance(blocked_by, list) or not all(
            isinstance(item, str) for item in blocked_by
        ):
            raise DesignerGraphValidationError("node_state.blocked_by must be a string array")
        state["blocked_by"] = list(blocked_by)
    return state


def normalize_execution_run(raw: Any) -> DesignerExecutionRun:
    if not isinstance(raw, dict):
        raise DesignerGraphValidationError("run must be an object")
    schema_version = _require_str(raw.get("schema_version"), "schema_version")
    if schema_version != RUN_SCHEMA_VERSION:
        raise DesignerGraphValidationError(
            f"unsupported run schema_version: {schema_version!r} "
            f"(expected {RUN_SCHEMA_VERSION!r})"
        )
    run_id = _require_str(raw.get("run_id"), "run_id")
    graph_id = _require_str(raw.get("graph_id"), "graph_id")
    project_id = _require_str(raw.get("project_id"), "project_id")
    status = _require_str(raw.get("status"), "status")
    if status not in RUN_STATUSES:
        raise DesignerGraphValidationError(f"unsupported run status: {status!r}")
    raw_states = raw.get("node_states")
    if not isinstance(raw_states, dict):
        raise DesignerGraphValidationError("node_states must be an object")
    node_states = {
        str(node_id): normalize_node_state(state)
        for node_id, state in raw_states.items()
    }
    current_node_ids = raw.get("current_node_ids")
    if current_node_ids is None:
        current_ids: list[str] = []
    elif not isinstance(current_node_ids, list) or not all(
        isinstance(item, str) for item in current_node_ids
    ):
        raise DesignerGraphValidationError("current_node_ids must be a string array")
    else:
        current_ids = list(current_node_ids)
    now = utc_now_ms()
    created_at = raw.get("created_at")
    updated_at = raw.get("updated_at")
    return {
        "schema_version": RUN_SCHEMA_VERSION,
        "run_id": run_id,
        "graph_id": graph_id,
        "project_id": project_id,
        "status": status,
        "node_states": node_states,
        "current_node_ids": current_ids,
        "created_at": int(created_at) if isinstance(created_at, int) else now,
        "updated_at": int(updated_at) if isinstance(updated_at, int) else now,
    }


def initial_node_states(graph: DesignerExecutionGraph) -> dict[str, DesignerNodeState]:
    return {node["id"]: {"status": NODE_STATUS_PENDING} for node in graph["nodes"]}


def node_config(node: DesignerGraphNode) -> DesignerNodeConfig:
    config = node.get("config")
    return config if isinstance(config, dict) else {}


def node_role(node: DesignerGraphNode) -> str:
    role = str(node_config(node).get("role") or "").strip()
    return role


def node_delegate(node: DesignerGraphNode) -> str:
    delegate = str(node_config(node).get("delegate") or CONFIG_DELEGATE_HANDLER).strip()
    return delegate if delegate in CONFIG_DELEGATES else CONFIG_DELEGATE_HANDLER


def apply_graph_patch(graph: DesignerExecutionGraph, patch: Any) -> DesignerExecutionGraph:
    """Merge upserts/removals into a domain graph, then re-normalize."""
    if patch is None:
        patch = {}
    if not isinstance(patch, dict):
        raise DesignerGraphValidationError("patch must be an object")
    raw = dict(graph)
    title = patch.get("title")
    if isinstance(title, str) and title.strip():
        raw["title"] = title.strip()
    if "description" in patch:
        description = patch.get("description")
        if description is not None and not isinstance(description, str):
            raise DesignerGraphValidationError("patch.description must be a string")
        raw["description"] = str(description or "")
    nodes_by_id = {node["id"]: dict(node) for node in raw.get("nodes") or []}
    upsert_nodes = patch.get("upsert_nodes") or []
    if not isinstance(upsert_nodes, list):
        raise DesignerGraphValidationError("patch.upsert_nodes must be an array")
    for item in upsert_nodes:
        node = normalize_node(item)
        nodes_by_id[node["id"]] = node
    remove_node_ids = patch.get("remove_node_ids") or []
    if not isinstance(remove_node_ids, list) or not all(
        isinstance(item, str) and item.strip() for item in remove_node_ids
    ):
        raise DesignerGraphValidationError("patch.remove_node_ids must be a string array")
    for node_id in remove_node_ids:
        nodes_by_id.pop(str(node_id).strip(), None)
    remaining_node_ids = set(nodes_by_id)
    edges_by_id = {edge["id"]: dict(edge) for edge in raw.get("edges") or []}
    upsert_edges = patch.get("upsert_edges") or []
    if not isinstance(upsert_edges, list):
        raise DesignerGraphValidationError("patch.upsert_edges must be an array")
    for item in upsert_edges:
        edge = normalize_edge(item)
        edges_by_id[edge["id"]] = edge
    remove_edge_ids = patch.get("remove_edge_ids") or []
    if not isinstance(remove_edge_ids, list) or not all(
        isinstance(item, str) and item.strip() for item in remove_edge_ids
    ):
        raise DesignerGraphValidationError("patch.remove_edge_ids must be a string array")
    for edge_id in remove_edge_ids:
        edges_by_id.pop(str(edge_id).strip(), None)
    raw["nodes"] = list(nodes_by_id.values())
    raw["edges"] = [
        edge
        for edge in edges_by_id.values()
        if edge.get("source") in remaining_node_ids and edge.get("target") in remaining_node_ids
    ]
    raw["updated_at"] = utc_now_ms()
    return normalize_execution_graph(raw)


def edge_kind(edge: DesignerGraphEdge) -> str:
    kind = str(edge.get("kind") or EDGE_KIND_DATA).strip()
    return kind if kind in EDGE_KINDS else EDGE_KIND_DATA


def data_predecessors(graph: DesignerExecutionGraph) -> dict[str, list[str]]:
    incoming: dict[str, list[str]] = {node["id"]: [] for node in graph.get("nodes", [])}
    for edge in graph.get("edges", []):
        if edge_kind(edge) != EDGE_KIND_DATA:
            continue
        source = edge.get("source")
        target = edge.get("target")
        if isinstance(source, str) and isinstance(target, str) and target in incoming:
            incoming[target].append(source)
    return incoming


def sync_groups(graph: DesignerExecutionGraph) -> dict[str, frozenset[str]]:
    """Union-find over undirected ``sync`` edges."""
    parent: dict[str, str] = {node["id"]: node["id"] for node in graph.get("nodes", [])}

    def find(node_id: str) -> str:
        while parent[node_id] != node_id:
            parent[node_id] = parent[parent[node_id]]
            node_id = parent[node_id]
        return node_id

    def union(left: str, right: str) -> None:
        root_left, root_right = find(left), find(right)
        if root_left != root_right:
            parent[root_right] = root_left

    for edge in graph.get("edges", []):
        if edge_kind(edge) != EDGE_KIND_SYNC:
            continue
        source = edge.get("source")
        target = edge.get("target")
        if isinstance(source, str) and isinstance(target, str) and source in parent and target in parent:
            union(source, target)

    groups: dict[str, set[str]] = {}
    for node_id in parent:
        root = find(node_id)
        groups.setdefault(root, set()).add(node_id)
    return {node_id: frozenset(groups[find(node_id)]) for node_id in parent}


def build_bootstrap_graph(
    *,
    project_id: str,
    prompt: str,
    title: str | None = None,
) -> DesignerExecutionGraph:
    """Create the default video-creation pipeline graph from an initial prompt."""
    graph_id = new_graph_id()
    now = utc_now_ms()
    prompt_text = prompt.strip()
    graph_title = title.strip() if isinstance(title, str) and title.strip() else prompt_text[:80]
    nodes: list[DesignerGraphNode] = [
        {
            "id": "n_brief",
            "type": NODE_TYPE_TEXT,
            "label": "项目 brief",
            "config": {"role": NODE_ROLE_BRIEF, "prompt": prompt_text},
            "layout": {"x": 40, "y": 120, "width": 280, "height": 160},
        },
        {
            "id": "n_character",
            "type": NODE_TYPE_IMAGE,
            "label": "角色图",
            "config": {"role": NODE_ROLE_CHARACTER_DESIGN, "inputs": ["n_brief"]},
            "layout": {"x": 380, "y": 40, "width": 280, "height": 160},
        },
        {
            "id": "n_scene",
            "type": NODE_TYPE_IMAGE,
            "label": "场景图",
            "config": {"role": NODE_ROLE_SCENE, "inputs": ["n_brief"]},
            "layout": {"x": 380, "y": 160, "width": 280, "height": 160},
        },
        {
            "id": "n_storyboard",
            "type": NODE_TYPE_TABLE,
            "label": "分镜表",
            "config": {"role": NODE_ROLE_STORYBOARD, "inputs": ["n_brief"]},
            "layout": {"x": 380, "y": 320, "width": 280, "height": 160},
        },
        {
            "id": "n_frame",
            "type": NODE_TYPE_IMAGE,
            "label": "视频帧",
            "config": {"role": NODE_ROLE_FRAME, "inputs": ["n_character", "n_scene", "n_storyboard"]},
            "layout": {"x": 720, "y": 140, "width": 320, "height": 200},
        },
        {
            "id": "n_clip",
            "type": NODE_TYPE_VIDEO,
            "label": "视频片段",
            "config": {"role": NODE_ROLE_CLIP, "inputs": ["n_character", "n_storyboard", "n_frame"]},
            "layout": {"x": 1040, "y": 160, "width": 260, "height": 150},
        },
    ]
    edges: list[DesignerGraphEdge] = [
        {"id": "e_brief_character", "source": "n_brief", "target": "n_character", "kind": EDGE_KIND_DATA},
        {"id": "e_brief_scene", "source": "n_brief", "target": "n_scene", "kind": EDGE_KIND_DATA},
        {"id": "e_brief_storyboard", "source": "n_brief", "target": "n_storyboard", "kind": EDGE_KIND_DATA},
        {
            "id": "e_character_storyboard",
            "source": "n_character",
            "target": "n_storyboard",
            "kind": EDGE_KIND_SYNC,
            "label": "对齐",
        },
        {
            "id": "e_scene_storyboard",
            "source": "n_scene",
            "target": "n_storyboard",
            "kind": EDGE_KIND_SYNC,
            "label": "对齐",
        },
        {"id": "e_character_frame", "source": "n_character", "target": "n_frame", "kind": EDGE_KIND_DATA},
        {"id": "e_scene_frame", "source": "n_scene", "target": "n_frame", "kind": EDGE_KIND_DATA},
        {"id": "e_storyboard_frame", "source": "n_storyboard", "target": "n_frame", "kind": EDGE_KIND_DATA},
        {"id": "e_character_clip", "source": "n_character", "target": "n_clip", "kind": EDGE_KIND_DATA},
        {"id": "e_storyboard_clip", "source": "n_storyboard", "target": "n_clip", "kind": EDGE_KIND_DATA},
        {"id": "e_frame_clip", "source": "n_frame", "target": "n_clip", "kind": EDGE_KIND_DATA},
    ]
    graph: DesignerExecutionGraph = {
        "schema_version": SCHEMA_VERSION,
        "graph_id": graph_id,
        "project_id": project_id,
        "title": graph_title,
        "description": prompt_text,
        "source": GRAPH_SOURCE_PROMPT,
        "nodes": nodes,
        "edges": edges,
        "metadata": {"bootstrap": "designer.graph.bootstrap.v1"},
        "created_at": now,
        "updated_at": now,
    }
    return normalize_execution_graph(graph)
