# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""Clip node handler: turn a graph prompt into a generated video file."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from jiuwenswarm.common.schema.designer_graph import (
    NODE_ROLE_BRIEF,
    NODE_ROLE_CHARACTER_DESIGN,
    NODE_ROLE_FRAME,
    NODE_ROLE_STORYBOARD,
    NODE_TYPE_VIDEO,
    AssetRef,
    DesignerExecutionGraph,
    DesignerGraphNode,
)
from jiuwenswarm.server.runtime.designer.handlers.common import (
    graph_prompt,
    role_output_image_path,
    role_output_image_paths,
    role_output_text,
)
from jiuwenswarm.server.runtime.designer.handlers.types import NodeExecutionContext, NodeResult

logger = logging.getLogger(__name__)


def collect_clip_first_frame(ctx: NodeExecutionContext | None) -> Path | None:
    """Prefer the first storyboard-matched keyframe; fall back to a leftover storyboard image."""
    if ctx is None:
        return None
    frames = role_output_image_paths(ctx, NODE_ROLE_FRAME)
    if frames:
        return frames[0]
    return role_output_image_path(ctx, NODE_ROLE_STORYBOARD)


def collect_clip_reference_images(ctx: NodeExecutionContext | None) -> list[Path]:
    """Keyframe stills for MiniMax reference-to-video, then optional character sheet.

    The storyboard is a markdown table and is sent as text in the prompt, not as
    an image. MiniMax H3 r2va accepts up to 9 reference images.
    """
    if ctx is None:
        return []
    paths = list(role_output_image_paths(ctx, NODE_ROLE_FRAME))
    character = role_output_image_path(ctx, NODE_ROLE_CHARACTER_DESIGN)
    if character is not None and character not in paths:
        paths.append(character)
    return paths[:9]


def _clip_prompt_lead(ctx: NodeExecutionContext | None) -> str:
    frames = role_output_image_paths(ctx, NODE_ROLE_FRAME) if ctx is not None else []
    character = (
        role_output_image_path(ctx, NODE_ROLE_CHARACTER_DESIGN) if ctx is not None else None
    )
    storyboard = role_output_text(ctx, NODE_ROLE_STORYBOARD) if ctx is not None else ""
    if frames:
        lines = [
            "制作一段 5 秒短视频。这是多模输入：文本里的分镜表是镜头脚本，参考图是各镜关键帧。",
        ]
        for index, _path in enumerate(frames, start=1):
            lines.append(f"参考图{index}对应分镜第{index}镜的关键帧，从该构图起幅并接到下一镜。")
        if character is not None:
            lines.append(
                f"参考图{len(frames) + 1}是角色设定图，全程保持外貌、服装和材质。"
            )
        if storyboard:
            lines.append("严格按下面分镜表的时间轴、镜头视角、运镜、人物变化和场景变化执行。")
        lines.append("不要加字幕。")
        return "".join(lines) + "\n\n"
    if character is not None:
        return (
            "制作一段 5 秒短视频。以提供的角色设定参考图保持角色外貌、服装和材质，"
            "再按 Brief、分镜表和运镜脚本运动镜头。不要加字幕。\n\n"
        )
    if collect_clip_first_frame(ctx) is not None:
        return (
            "制作一段 5 秒短视频。以提供的首帧关键帧为起始画面，"
            "保持角色外貌、服装、场景和构图一致，再按 Brief、分镜表和运镜脚本运动镜头。"
            "不要加字幕。\n\n"
        )
    return "制作一段 5 秒短视频，严格按下面的 Brief、分镜表和运镜脚本执行。不要加字幕。\n\n"


def build_clip_prompt(
    graph: DesignerExecutionGraph,
    node: DesignerGraphNode,
    ctx: NodeExecutionContext | None = None,
) -> str:
    """Storyboard table + brief as text; keyframes are attached separately as images."""
    parts: list[str] = []
    if ctx is not None:
        brief = role_output_text(ctx, NODE_ROLE_BRIEF)
        storyboard = role_output_text(ctx, NODE_ROLE_STORYBOARD)
        if brief:
            parts.append(brief)
        if storyboard:
            parts.append(storyboard)
    if not parts:
        parts.append(graph_prompt(graph, node))
    assembled = "\n\n".join(parts).strip()
    return (_clip_prompt_lead(ctx) + assembled)[:6000]


async def generate_clip_video(
    prompt: str,
    save_dir: str | None = None,
    first_frame: str | None = None,
    reference_images: list[str] | None = None,
) -> dict[str, Any]:
    """Call the shared video-generation stack. Tests monkeypatch this function."""
    from jiuwenswarm.agents.harness.common.tools.multimodal_config import (
        apply_video_gen_model_config_from_yaml,
    )
    from jiuwenswarm.agents.harness.common.tools.video_tools import (
        _invoke_model_video_generation,
    )
    from jiuwenswarm.common.config import get_config

    try:
        apply_video_gen_model_config_from_yaml(get_config())
    except Exception:
        logger.debug("Failed to apply video_gen model config from yaml", exc_info=True)

    result = await _invoke_model_video_generation(
        prompt,
        first_frame=first_frame,
        reference_images=reference_images,
    )
    if "error" in result:
        raise RuntimeError(str(result["error"]))

    video_path = str(result.get("video_path") or "").strip()
    if not video_path:
        raise RuntimeError("video generation returned no video_path")

    if save_dir:
        dest_dir = Path(save_dir)
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / Path(video_path).name
        Path(video_path).replace(dest)
        result = {**result, "video_path": str(dest.resolve())}

    return result


class ClipNodeHandler:
    """Replace the clip stub with a real MiniMax / video_gen job."""

    async def execute(self, node: DesignerGraphNode, ctx: NodeExecutionContext) -> NodeResult:
        prompt = build_clip_prompt(ctx.graph, node, ctx)
        references = collect_clip_reference_images(ctx)
        first_frame = collect_clip_first_frame(ctx)
        if references:
            result = await generate_clip_video(
                prompt,
                reference_images=[str(path) for path in references],
            )
        else:
            result = await generate_clip_video(
                prompt,
                first_frame=str(first_frame) if first_frame is not None else None,
            )
        path = Path(str(result["video_path"]))
        output_ref: AssetRef = {
            "kind": NODE_TYPE_VIDEO,
            "uri": path.resolve().as_uri(),
            "mime_type": "video/mp4",
            "label": path.name,
        }
        return NodeResult(output_ref=output_ref, message="clip generated")
