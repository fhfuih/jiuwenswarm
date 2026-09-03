# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""Image intermediate handlers: character sheet, scene, and keyframe."""

from __future__ import annotations

from pathlib import Path
from shutil import copy2

from jiuwenswarm.common.schema.designer_graph import (
    NODE_ROLE_BRIEF,
    NODE_ROLE_CHARACTER_DESIGN,
    NODE_ROLE_SCENE,
    NODE_ROLE_STORYBOARD,
    NODE_TYPE_IMAGE,
    NODE_TYPE_TEXT,
    AssetRef,
    DesignerGraphNode,
)
from jiuwenswarm.server.runtime.designer.handlers import common as handler_io
from jiuwenswarm.server.runtime.designer.handlers.common import (
    file_output_ref,
    graph_prompt,
    role_output_image_path,
    role_output_text,
    write_workspace_text,
)
from jiuwenswarm.server.runtime.designer.a2a_collab import collaboration_card
from jiuwenswarm.server.runtime.designer.handlers.text_nodes import (
    StoryboardShot,
    storyboard_shots_or_default,
)
from jiuwenswarm.server.runtime.designer.handlers.types import NodeExecutionContext, NodeResult


def _character_prompt(source: str) -> str:
    return (
        "角色设定图，单一主体，全身或半身，干净背景，电影灯光，赛博朋克或按描述。"
        "不要字幕、不要分镜格子。\n"
        f"{source}"
    )


def _scene_prompt(source: str) -> str:
    return (
        "电影场景建立镜头，只有环境没有人物。"
        "交代空间、天气、光线、招牌和地面，适合后续把角色放进去。"
        "不要人物、不要字幕、不要分镜格子。\n"
        f"{source}"
    )


def _strip_markdown_tables(text: str) -> str:
    """Keep prose from Brief; drop markdown tables so the image model does not paint them."""
    lines: list[str] = []
    for line in (text or "").splitlines():
        stripped = line.strip()
        if stripped.count("|") >= 2:
            continue
        if stripped.startswith("|") or stripped.endswith("|"):
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def _shot_frame_prompt(
    shot: StoryboardShot,
    brief: str,
    *,
    has_character: bool,
    has_scene: bool,
) -> str:
    timeline = f"（{shot['timeline']}）" if shot["timeline"] else ""
    lead = (
        f"电影关键帧，单幅写实静帧，对应分镜第 {shot['shot_no']} 镜{timeline}。"
        "构图清楚，只画这一镜的瞬间，不要多格拼图。"
    )
    if shot["camera"]:
        lead += f"镜头视角：{shot['camera']}。"
    if shot["move"]:
        lead += f"运镜停在这一瞬间：{shot['move']}。"
    if shot["character_action"]:
        lead += f"人物：{shot['character_action']}。"
    if shot["scene_change"]:
        lead += f"场景：{shot['scene_change']}。"
    if has_character and has_scene:
        lead += (
            "这是图生图：第一张参考图是角色设定，第二张是场景。"
            "把角色放入该场景，保持角色外貌、服装、材质，以及场景的空间、光线和天气。"
        )
    elif has_character:
        lead += "角色外貌、服装和材质必须与角色设定参考图一致，不要另造一套造型。"
    elif has_scene:
        lead += "场景空间、光线和天气必须与场景参考图一致。"
    lead += (
        "画面里只能是电影场景本身。"
        "不要字幕、不要分镜格子、不要表格、不要Excel、不要单元格、不要竖线表头。"
        "不要把「镜号」「时间轴」「镜头视角」「运镜」「人物变化」「场景变化」这些词画进画面。"
    )
    visual = _strip_markdown_tables(brief)
    if visual:
        return f"{lead}\n整体视觉风格参考：\n{visual}"
    return lead


def fallback_character_sheet(source: str) -> str:
    return (
        "# 角色设定\n\n"
        f"{source.strip()}\n\n"
        "- 外形：按 Brief 中的主体描述\n"
        "- 服装/材质：与雨夜霓虹或用户指定风格一致\n"
        "- 未配置图片生成时，先用这份设定稿作为中间产物\n"
    )


def fallback_scene_notes(source: str) -> str:
    return (
        "# 场景\n\n"
        f"{source.strip()}\n\n"
        "- 只画环境，不画人物\n"
        "- 未配置图片生成时，先用这份场景说明\n"
    )


def fallback_keyframe_script(source: str) -> str:
    shots = storyboard_shots_or_default(source)
    lines = [
        "# 关键帧\n",
        f"{source.strip()}\n",
        f"- 应按分镜表生成 {len(shots)} 张关键帧，一镜一图\n",
    ]
    for shot in shots:
        lines.append(
            f"- 第 {shot['shot_no']} 镜 {shot['timeline']}: {shot['camera']} / {shot['move']}\n"
        )
    lines.append("- 未配置图片生成时，先用这份关键帧说明\n")
    return "".join(lines)


def _publish_shot_image(src: Path, *, stem: str) -> Path:
    dest = handler_io.get_agent_workspace_dir() / f"{stem}{src.suffix or '.png'}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.resolve() != src.resolve():
        copy2(src, dest)
    return dest.resolve()


async def _image_or_notes(
    *,
    prompt: str,
    notes: str,
    stem: str,
    kind_if_text: str,
    reference_images: list[str] | None = None,
) -> NodeResult:
    generated = await handler_io.generate_designer_image(
        prompt,
        reference_images=reference_images,
    )
    if generated and generated.get("image_path"):
        path = Path(generated["image_path"])
        return NodeResult(
            output_ref=file_output_ref(path, kind=NODE_TYPE_IMAGE, mime_type="image/png"),
            message="image generated",
        )
    path = write_workspace_text(stem, notes)
    return NodeResult(
        output_ref=file_output_ref(path, kind=kind_if_text, mime_type="text/markdown"),
        message="image_gen unavailable, wrote notes",
    )


def _aligned_source(ctx: NodeExecutionContext, role: str, node: DesignerGraphNode) -> str:
    return (
        collaboration_card(ctx.run_id, role)
        or role_output_text(ctx, NODE_ROLE_BRIEF)
        or graph_prompt(ctx.graph, node)
    )


def _with_card_ref(result: NodeResult, ctx: NodeExecutionContext, role: str) -> NodeResult:
    card = collaboration_card(ctx.run_id, role)
    if not card:
        return result
    path = write_workspace_text(f"designer_a2a_{ctx.run_id}_{role}", card)
    card_ref = file_output_ref(path, kind=NODE_TYPE_TEXT, mime_type="text/markdown")
    refs = [ref for ref in (result.output_refs or []) if ref]
    primary = result.output_ref
    if primary is not None and primary not in refs:
        refs.insert(0, primary)
    if card_ref not in refs:
        refs.append(card_ref)
    return NodeResult(
        output_ref=primary,
        output_refs=refs or [card_ref],
        message=result.message,
    )


class CharacterDesignNodeHandler:
    async def execute(self, node: DesignerGraphNode, ctx: NodeExecutionContext) -> NodeResult:
        source = _aligned_source(ctx, NODE_ROLE_CHARACTER_DESIGN, node)
        result = await _image_or_notes(
            prompt=_character_prompt(source),
            notes=fallback_character_sheet(source),
            stem=f"designer_character_{ctx.run_id}_{ctx.node_id}",
            kind_if_text=NODE_TYPE_TEXT,
        )
        return _with_card_ref(result, ctx, NODE_ROLE_CHARACTER_DESIGN)


class SceneNodeHandler:
    async def execute(self, node: DesignerGraphNode, ctx: NodeExecutionContext) -> NodeResult:
        source = _aligned_source(ctx, NODE_ROLE_SCENE, node)
        result = await _image_or_notes(
            prompt=_scene_prompt(source),
            notes=fallback_scene_notes(source),
            stem=f"designer_scene_{ctx.run_id}_{ctx.node_id}",
            kind_if_text=NODE_TYPE_TEXT,
        )
        return _with_card_ref(result, ctx, NODE_ROLE_SCENE)


class FrameNodeHandler:
    async def execute(self, node: DesignerGraphNode, ctx: NodeExecutionContext) -> NodeResult:
        storyboard = role_output_text(ctx, NODE_ROLE_STORYBOARD)
        brief = role_output_text(ctx, NODE_ROLE_BRIEF)
        character = role_output_image_path(ctx, NODE_ROLE_CHARACTER_DESIGN)
        scene = role_output_image_path(ctx, NODE_ROLE_SCENE)
        visual = brief or graph_prompt(ctx.graph, node)
        refs: list[str] = []
        if character is not None:
            refs.append(str(character))
        if scene is not None:
            refs.append(str(scene))
        shots = storyboard_shots_or_default(storyboard, visual)
        images: list[AssetRef] = []
        for index, shot in enumerate(shots, start=1):
            generated = await handler_io.generate_designer_image(
                _shot_frame_prompt(
                    shot,
                    visual,
                    has_character=character is not None,
                    has_scene=scene is not None,
                ),
                reference_images=refs or None,
            )
            if not generated or not generated.get("image_path"):
                continue
            path = _publish_shot_image(
                Path(generated["image_path"]),
                stem=f"designer_frame_{ctx.run_id}_{ctx.node_id}_shot{index}",
            )
            images.append(file_output_ref(path, kind=NODE_TYPE_IMAGE, mime_type="image/png"))
        if images:
            return NodeResult(
                output_ref=images[0],
                output_refs=images,
                message=f"{len(images)} keyframes generated",
            )
        notes = fallback_keyframe_script(storyboard or visual)
        path = write_workspace_text(f"designer_frame_{ctx.run_id}_{ctx.node_id}", notes)
        ref = file_output_ref(path, kind=NODE_TYPE_TEXT, mime_type="text/markdown")
        return NodeResult(
            output_ref=ref,
            output_refs=[ref],
            message="image_gen unavailable, wrote notes",
        )
