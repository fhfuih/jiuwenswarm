# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""Unit tests for Designer graph store and bootstrap schema."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from jiuwenswarm.common.schema.designer_graph import (
    EDGE_KIND_SYNC,
    NODE_ROLE_CHARACTER_DESIGN,
    NODE_ROLE_CLIP,
    NODE_ROLE_SCENE,
    NODE_ROLE_STORYBOARD,
    NODE_TYPE_IMAGE,
    NODE_TYPE_TABLE,
    NODE_TYPE_TEXT,
    NODE_TYPE_VIDEO,
    NODE_STATUS_COMPLETED,
    RUN_STATUS_COMPLETED,
    RUN_STATUS_RUNNING,
    DesignerGraphValidationError,
    apply_graph_patch,
    build_bootstrap_graph,
    normalize_execution_graph,
    normalize_node,
    node_role,
)
from jiuwenswarm.server.runtime.designer.executor import GraphExecutor
from jiuwenswarm.server.runtime.designer.graph_store import DesignerGraphStore


@pytest.fixture()
def stub_clip_video(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_text(prompt: str, max_tokens: int = 1200) -> str:
        if "分镜" in prompt or "运镜" in prompt:
            return (
                "## 分镜表\n\n"
                "| 镜号 | 时间轴 | 镜头视角 | 运镜 | 人物变化 | 场景变化 |\n"
                "| --- | --- | --- | --- | --- | --- |\n"
                "| 1 | 0.0-2.0s | 全景/略俯 | 缓摇 | 未入画 | 雨夜巷 |\n"
                "| 2 | 2.0-3.5s | 中景/平视 | 跟移 | 主体入画 | 霓虹闪 |\n"
                "| 3 | 3.5-5.0s | 近景/平视 | 固定 | 转身 | 积水碎开 |\n"
            )
        return f"# stub\n{prompt[:80]}"

    image_seq = {"n": 0}

    async def fake_image(
        prompt: str,
        size: str = "512x512",
        reference_image: str | None = None,
        reference_images: list[str] | None = None,
    ) -> dict[str, str]:
        image_seq["n"] += 1
        path = tmp_path / f"generated_{image_seq['n']}.png"
        path.write_bytes(b"png")
        return {"image_path": str(path)}

    video_seq = {"n": 0}

    async def fake_video(
        prompt: str,
        save_dir: str | None = None,
        first_frame: str | None = None,
        reference_images: list[str] | None = None,
    ) -> dict[str, str]:
        video_seq["n"] += 1
        path = tmp_path / f"generated_clip_{video_seq['n']}.mp4"
        path.write_bytes(b"mp4")
        return {"video_path": str(path), "revised_prompt": prompt}

    monkeypatch.setattr(
        "jiuwenswarm.server.runtime.designer.handlers.common.get_agent_workspace_dir",
        lambda: tmp_path,
    )
    monkeypatch.setattr(
        "jiuwenswarm.server.runtime.designer.handlers.common.complete_designer_text",
        fake_text,
    )
    monkeypatch.setattr(
        "jiuwenswarm.server.runtime.designer.handlers.common.generate_designer_image",
        fake_image,
    )
    monkeypatch.setattr(
        "jiuwenswarm.server.runtime.designer.handlers.clip.generate_clip_video",
        fake_video,
    )


@pytest.fixture()
def designer_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> DesignerGraphStore:
    monkeypatch.setattr(
        "jiuwenswarm.server.runtime.designer.graph_store.get_agent_root_dir",
        lambda: tmp_path,
    )
    return DesignerGraphStore()


def test_bootstrap_graph_uses_modality_node_types() -> None:
    graph = build_bootstrap_graph(
        project_id="proj_test01",
        prompt="test prompt",
        title="Test Video",
    )
    assert graph["schema_version"] == "designer-execution-graph.v1"
    node_types = {node["type"] for node in graph["nodes"]}
    assert node_types <= {NODE_TYPE_TEXT, NODE_TYPE_TABLE, NODE_TYPE_IMAGE, NODE_TYPE_VIDEO}
    assert NODE_TYPE_TEXT in node_types
    assert NODE_TYPE_IMAGE in node_types
    roles = {node_role(node) for node in graph["nodes"]}
    assert {NODE_ROLE_CHARACTER_DESIGN, NODE_ROLE_SCENE, NODE_ROLE_STORYBOARD} <= roles
    sync_edges = [edge for edge in graph["edges"] if edge.get("kind") == EDGE_KIND_SYNC]
    assert len(sync_edges) == 2
    sync_pairs = {frozenset((edge["source"], edge["target"])) for edge in sync_edges}
    assert sync_pairs == {
        frozenset({"n_character", "n_storyboard"}),
        frozenset({"n_scene", "n_storyboard"}),
    }
    assert any(edge["source"] == "n_frame" and edge["target"] == "n_clip" for edge in graph["edges"])
    assert any(edge["source"] == "n_scene" and edge["target"] == "n_frame" for edge in graph["edges"])
    clip = next(node for node in graph["nodes"] if node["id"] == "n_clip")
    assert "n_frame" in ((clip.get("config") or {}).get("inputs") or [])


def test_graph_store_roundtrip(designer_store: DesignerGraphStore) -> None:
    graph = build_bootstrap_graph(project_id="proj_test01", prompt="roundtrip")
    saved = designer_store.save_graph(graph)
    loaded = designer_store.get_graph(saved["graph_id"])
    assert loaded is not None
    assert loaded["graph_id"] == saved["graph_id"]
    assert loaded["project_id"] == "proj_test01"


def test_fixture_file_normalizes() -> None:
    fixture = (
        Path(__file__).resolve().parents[3]
        / "jiuwenswarm"
        / "channels"
        / "web"
        / "frontend"
        / "tests"
        / "fixtures"
        / "designer-execution-graph.v1.json"
    )
    payload = json.loads(fixture.read_text(encoding="utf-8"))
    graph = normalize_execution_graph(payload)
    assert graph["title"] == "赛博朋克街景短视频"
    assert any(edge["source"] == "n_frame" and edge["target"] == "n_clip" for edge in graph["edges"])


def test_normalize_adds_frame_to_clip_on_old_bootstrap() -> None:
    graph = build_bootstrap_graph(project_id="proj_old01", prompt="legacy")
    graph["edges"] = [
        edge
        for edge in graph["edges"]
        if not (edge.get("source") == "n_frame" and edge.get("target") == "n_clip")
    ]
    clip = next(node for node in graph["nodes"] if node["id"] == "n_clip")
    clip["config"] = {"role": NODE_ROLE_CLIP, "inputs": ["n_character", "n_storyboard"]}
    restored = normalize_execution_graph(graph)
    assert any(
        edge["source"] == "n_frame" and edge["target"] == "n_clip" for edge in restored["edges"]
    )
    restored_clip = next(node for node in restored["nodes"] if node["id"] == "n_clip")
    assert "n_frame" in ((restored_clip.get("config") or {}).get("inputs") or [])


def test_normalize_adds_scene_storyboard_sync_on_old_bootstrap() -> None:
    graph = build_bootstrap_graph(project_id="proj_old02", prompt="legacy-align")
    graph["edges"] = [
        edge
        for edge in graph["edges"]
        if not (edge.get("source") == "n_scene" and edge.get("target") == "n_storyboard")
    ]
    restored = normalize_execution_graph(graph)
    assert any(
        edge.get("source") == "n_scene"
        and edge.get("target") == "n_storyboard"
        and edge.get("kind") == EDGE_KIND_SYNC
        for edge in restored["edges"]
    )


def test_graph_store_list_by_project(designer_store: DesignerGraphStore) -> None:
    first = designer_store.save_graph(
        build_bootstrap_graph(project_id="proj_list_a", prompt="first"),
    )
    second = designer_store.save_graph(
        build_bootstrap_graph(project_id="proj_list_a", prompt="second"),
    )
    designer_store.save_graph(
        build_bootstrap_graph(project_id="proj_list_b", prompt="other project"),
    )
    graphs = designer_store.list_graphs_for_project("proj_list_a")
    graph_ids = {graph["graph_id"] for graph in graphs}
    assert graph_ids == {first["graph_id"], second["graph_id"]}
    all_ids = {graph["graph_id"] for graph in designer_store.list_graphs()}
    assert first["graph_id"] in all_ids
    assert second["graph_id"] in all_ids


@pytest.mark.asyncio
async def test_mock_executor_completes_run(
    designer_store: DesignerGraphStore, stub_clip_video: None
) -> None:
    graph = designer_store.save_graph(
        build_bootstrap_graph(project_id="proj_exec01", prompt="execute me"),
    )
    executor = GraphExecutor(designer_store)
    run = executor.create_run(graph)
    started = await executor.start_run(run["run_id"])
    assert started["status"] == RUN_STATUS_RUNNING
    task = executor._tasks.get(run["run_id"])
    if task is not None:
        await task
    finished = designer_store.get_run(run["run_id"])
    assert finished is not None
    assert finished["status"] == RUN_STATUS_COMPLETED
    node_states = finished["node_states"]
    assert all(
        state.get("status") == NODE_STATUS_COMPLETED for state in node_states.values()
    )
    character = node_states["n_character"]
    storyboard = node_states["n_storyboard"]
    frame = node_states["n_frame"]
    assert str(character.get("output_ref", {}).get("uri") or "").startswith("file:")
    assert str(storyboard.get("output_ref", {}).get("uri") or "").startswith("file:")
    assert len(frame.get("output_refs") or []) == 3
    clip = node_states["n_clip"]
    assert clip.get("output_ref", {}).get("kind") == NODE_TYPE_VIDEO
    assert str(clip.get("output_ref", {}).get("label") or "").endswith(".mp4")
    assert (character.get("started_at") or 0) <= (frame.get("started_at") or 0)
    assert (storyboard.get("started_at") or 0) <= (frame.get("started_at") or 0)
    assert (frame.get("completed_at") or 0) <= (clip.get("started_at") or 0)


@pytest.mark.asyncio
async def test_rerun_single_node_keeps_upstream_outputs(
    designer_store: DesignerGraphStore, stub_clip_video: None
) -> None:
    graph = designer_store.save_graph(
        build_bootstrap_graph(project_id="proj_rerun01", prompt="rerun clip"),
    )
    executor = GraphExecutor(designer_store)
    first = executor.create_run(graph)
    await executor.start_run(first["run_id"])
    task = executor._tasks.get(first["run_id"])
    if task is not None:
        await task
    finished = designer_store.get_run(first["run_id"])
    assert finished is not None
    brief_started = finished["node_states"]["n_brief"].get("started_at")
    brief_uri = (finished["node_states"]["n_brief"].get("output_ref") or {}).get("uri")

    rerun = executor.create_rerun(graph, source_run=finished, node_id="n_clip")
    assert rerun["node_states"]["n_clip"]["status"] == "pending"
    assert rerun["node_states"]["n_brief"]["status"] == NODE_STATUS_COMPLETED
    await executor.start_run(rerun["run_id"])
    worker = executor._tasks.get(rerun["run_id"])
    if worker is not None:
        await worker
    again = designer_store.get_run(rerun["run_id"])
    assert again is not None
    assert again["status"] == RUN_STATUS_COMPLETED
    assert again["node_states"]["n_brief"].get("started_at") == brief_started
    assert (again["node_states"]["n_brief"].get("output_ref") or {}).get("uri") == brief_uri
    assert again["node_states"]["n_clip"]["status"] == NODE_STATUS_COMPLETED
    original_clip = (finished["node_states"]["n_clip"].get("output_ref") or {}).get("uri")
    new_clip = (again["node_states"]["n_clip"].get("candidate_output_ref") or {}).get("uri")
    assert (again["node_states"]["n_clip"].get("output_ref") or {}).get("uri") == original_clip
    assert new_clip
    assert new_clip != original_clip

    kept = executor.choose_output(again["run_id"], "n_clip", "new")
    assert (kept["node_states"]["n_clip"].get("output_ref") or {}).get("uri") == new_clip
    assert not (kept["node_states"]["n_clip"].get("candidate_output_ref") or {}).get("uri")

    with pytest.raises(ValueError, match="upstream not ready"):
        unfinished = {
            **finished,
            "node_states": {
                **finished["node_states"],
                "n_storyboard": {"status": "pending"},
            },
        }
        executor.create_rerun(graph, source_run=unfinished, node_id="n_clip")


def test_bootstrap_treats_default_project_as_create(designer_store: DesignerGraphStore, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from types import SimpleNamespace

    from jiuwenswarm.server.runtime.gateway_adapter import designer_adapter as adapter

    monkeypatch.setattr(adapter, "_store", designer_store)
    monkeypatch.setattr(adapter, "resolve_request_work_mode", lambda params, channel: ("work", None))
    monkeypatch.setattr(
        adapter.project_store,
        "resolve_default_project_dir",
        lambda name, mode: str(tmp_path / "designer-project"),
    )
    created: list[tuple[str, str, str]] = []

    def fake_create(name: str, project_dir: str, work_mode: str):
        created.append((name, project_dir, work_mode))
        return (
            SimpleNamespace(
                project_id="proj_created01",
                project_dir=project_dir,
                work_mode=work_mode,
                hidden=False,
            ),
            False,
        )

    monkeypatch.setattr(adapter.project_store, "create_or_restore_project", fake_create)

    payload, error, code = adapter._bootstrap_graph(
        {"prompt": "雨夜短片", "project_id": "default"},
        "web",
    )
    assert error is None
    assert code is None
    assert payload is not None
    assert payload["project_id"] == "proj_created01"
    assert payload["graph"]["title"] == "雨夜短片"
    assert created


def test_list_graphs_includes_video_summary(
    designer_store: DesignerGraphStore, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from jiuwenswarm.server.runtime.gateway_adapter import designer_adapter as adapter

    monkeypatch.setattr(adapter, "_store", designer_store)
    graph = designer_store.save_graph(
        build_bootstrap_graph(project_id="proj_sum01", prompt="clip ready"),
    )
    designer_store.save_run(
        {
            "schema_version": "designer-execution-run.v1",
            "run_id": "run_sum01",
            "graph_id": graph["graph_id"],
            "project_id": "proj_sum01",
            "status": RUN_STATUS_COMPLETED,
            "node_states": {
                "n_clip": {
                    "status": NODE_STATUS_COMPLETED,
                    "output_ref": {
                        "kind": NODE_TYPE_VIDEO,
                        "uri": (tmp_path / "generated_clip.mp4").resolve().as_uri(),
                        "label": "generated_clip.mp4",
                    },
                }
            },
            "current_node_ids": [],
        }
    )
    payload, error, code = adapter._list_graphs({})
    assert error is None
    assert code is None
    assert payload is not None
    summary = next(item for item in payload["summaries"] if item["graph_id"] == graph["graph_id"])
    assert summary["has_video"] is True
    assert summary["clip_label"] == "generated_clip.mp4"


@pytest.mark.asyncio
async def test_sync_peers_start_together_and_block_downstream(
    designer_store: DesignerGraphStore,
    monkeypatch: pytest.MonkeyPatch,
    stub_clip_video: None,
) -> None:
    import time

    from jiuwenswarm.server.runtime.designer import executor as executor_mod
    from jiuwenswarm.server.runtime.designer.handlers import NODE_HANDLERS, RoleNodeHandler

    monkeypatch.setattr(executor_mod, "_MOCK_NODE_DELAY_SECONDS", 0.05)
    starts: dict[str, float] = {}
    original = NODE_HANDLERS[NODE_ROLE_CHARACTER_DESIGN]

    class TimedHandler(RoleNodeHandler):
        async def execute(self, node, ctx):
            starts[node["id"]] = time.monotonic()
            return await original.execute(node, ctx)

    monkeypatch.setitem(NODE_HANDLERS, NODE_ROLE_CHARACTER_DESIGN, TimedHandler(NODE_ROLE_CHARACTER_DESIGN))
    monkeypatch.setitem(NODE_HANDLERS, NODE_ROLE_STORYBOARD, TimedHandler(NODE_ROLE_STORYBOARD))
    monkeypatch.setitem(NODE_HANDLERS, "frame", TimedHandler("frame"))

    graph = designer_store.save_graph(
        build_bootstrap_graph(project_id="proj_sync01", prompt="align peers"),
    )
    execu = GraphExecutor(designer_store)
    run = execu.create_run(graph)
    events = [event async for event in execu.run(graph, run["run_id"])]
    assert events
    assert any(event.event == "designer.run.updated" for event in events)
    finished = designer_store.get_run(run["run_id"])
    assert finished is not None
    assert finished["status"] == RUN_STATUS_COMPLETED
    assert abs(starts["n_character"] - starts["n_storyboard"]) < 0.04
    assert starts["n_frame"] > max(starts["n_character"], starts["n_storyboard"])


@pytest.mark.asyncio
async def test_sync_barrier_blocks_even_without_second_data_edge(
    designer_store: DesignerGraphStore,
    monkeypatch: pytest.MonkeyPatch,
    stub_clip_video: None,
) -> None:
    from jiuwenswarm.common.schema.designer_graph import (
        EDGE_KIND_DATA,
        EDGE_KIND_SYNC,
        NODE_TYPE_IMAGE,
        NODE_TYPE_TEXT,
        SCHEMA_VERSION,
        normalize_execution_graph,
    )
    from jiuwenswarm.server.runtime.designer import executor as executor_mod

    monkeypatch.setattr(executor_mod, "_MOCK_NODE_DELAY_SECONDS", 0)
    graph = designer_store.save_graph(
        normalize_execution_graph(
            {
                "schema_version": SCHEMA_VERSION,
                "graph_id": "graph_barrier01",
                "project_id": "proj_barrier01",
                "title": "barrier",
                "source": "manual",
                "nodes": [
                    {"id": "a", "type": NODE_TYPE_TEXT, "label": "A", "config": {"role": "brief"}},
                    {
                        "id": "b",
                        "type": NODE_TYPE_IMAGE,
                        "label": "B",
                        "config": {"role": NODE_ROLE_CHARACTER_DESIGN},
                    },
                    {
                        "id": "c",
                        "type": NODE_TYPE_TABLE,
                        "label": "C",
                        "config": {"role": NODE_ROLE_STORYBOARD},
                    },
                    {"id": "d", "type": NODE_TYPE_IMAGE, "label": "D", "config": {"role": "frame"}},
                ],
                "edges": [
                    {"id": "e1", "source": "a", "target": "b", "kind": EDGE_KIND_DATA},
                    {"id": "e2", "source": "a", "target": "c", "kind": EDGE_KIND_DATA},
                    {"id": "e3", "source": "b", "target": "c", "kind": EDGE_KIND_SYNC},
                    {"id": "e4", "source": "b", "target": "d", "kind": EDGE_KIND_DATA},
                ],
            }
        )
    )
    execu = GraphExecutor(designer_store)
    run = execu.create_run(graph)
    await execu.start_run(run["run_id"])
    worker = execu._tasks.get(run["run_id"])
    if worker is not None:
        await worker
    finished = designer_store.get_run(run["run_id"])
    assert finished is not None
    assert finished["status"] == RUN_STATUS_COMPLETED
    assert (finished["node_states"]["c"].get("completed_at") or 0) <= (
        finished["node_states"]["d"].get("started_at") or 0
    )


def test_normalize_node_rejects_unknown_role() -> None:
    with pytest.raises(DesignerGraphValidationError, match="unsupported node role"):
        normalize_node(
            {
                "id": "n_x",
                "type": NODE_TYPE_TEXT,
                "label": "x",
                "config": {"role": "not_a_role"},
            }
        )


def test_normalize_node_accepts_typed_config() -> None:
    node = normalize_node(
        {
            "id": "n_brief",
            "type": NODE_TYPE_TEXT,
            "label": "brief",
            "config": {
                "role": "brief",
                "prompt": "雨夜",
                "inputs": ["n_src"],
                "delegate": "handler",
            },
        }
    )
    assert node["config"]["role"] == "brief"
    assert node["config"]["prompt"] == "雨夜"
    assert node["config"]["inputs"] == ["n_src"]
    assert node["config"]["delegate"] == "handler"


def test_apply_graph_patch_upserts_and_removes() -> None:
    graph = build_bootstrap_graph(project_id="proj_patch01", prompt="patch me")
    patched = apply_graph_patch(
        graph,
        {
            "title": "改过的标题",
            "upsert_nodes": [
                {
                    "id": "n_extra",
                    "type": NODE_TYPE_TEXT,
                    "label": "备注",
                    "config": {"role": "brief", "prompt": "extra"},
                }
            ],
            "upsert_edges": [
                {
                    "id": "e_brief_extra",
                    "source": "n_brief",
                    "target": "n_extra",
                    "kind": "data",
                }
            ],
        },
    )
    assert patched["title"] == "改过的标题"
    assert any(node["id"] == "n_extra" for node in patched["nodes"])
    assert any(edge["id"] == "e_brief_extra" for edge in patched["edges"])
    removed = apply_graph_patch(
        patched,
        {"remove_node_ids": ["n_extra"], "remove_edge_ids": ["e_brief_extra"]},
    )
    assert all(node["id"] != "n_extra" for node in removed["nodes"])
    assert all(edge["id"] != "e_brief_extra" for edge in removed["edges"])


@pytest.mark.asyncio
async def test_executor_on_update_includes_node_id(
    designer_store: DesignerGraphStore, stub_clip_video: None
) -> None:
    events: list[str | None] = []

    def on_update(run, node_id=None):  # noqa: ANN001
        events.append(node_id)

    graph = designer_store.save_graph(
        build_bootstrap_graph(project_id="proj_evt01", prompt="events"),
    )
    executor = GraphExecutor(designer_store)
    run = executor.create_run(graph)
    await executor.start_run(run["run_id"], on_update=on_update)
    task = executor._tasks.get(run["run_id"])
    if task is not None:
        await task
    assert "n_brief" in events
    assert None in events


@pytest.mark.asyncio
async def test_subagent_delegate_uses_registered_runner(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from jiuwenswarm.server.runtime.designer.handlers.text_nodes import BriefNodeHandler
    from jiuwenswarm.server.runtime.designer.handlers.types import NodeExecutionContext
    from jiuwenswarm.server.runtime.designer.subagent import register_designer_subagent_runner

    monkeypatch.setattr(
        "jiuwenswarm.server.runtime.designer.handlers.common.get_agent_workspace_dir",
        lambda: tmp_path,
    )

    async def runner(prompt: str) -> str:
        return f"FROM_SUBAGENT:{prompt[:12]}"

    register_designer_subagent_runner(runner)
    try:
        graph = normalize_execution_graph(
            {
                "schema_version": "designer-execution-graph.v1",
                "graph_id": "graph_sub01",
                "project_id": "proj_sub01",
                "title": "sub",
                "description": "x",
                "source": "manual",
                "nodes": [
                    {
                        "id": "n_brief",
                        "type": NODE_TYPE_TEXT,
                        "label": "brief",
                        "config": {
                            "role": "brief",
                            "prompt": "雨夜",
                            "delegate": "subagent",
                        },
                    }
                ],
                "edges": [],
            }
        )
        result = await BriefNodeHandler().execute(
            graph["nodes"][0],
            NodeExecutionContext(graph=graph, run_id="run_sub01", node_id="n_brief"),
        )
        assert result.output_ref is not None
        text = (tmp_path / Path(result.output_ref["label"])).read_text(encoding="utf-8")
        assert text.startswith("FROM_SUBAGENT:")
    finally:
        register_designer_subagent_runner(None)
