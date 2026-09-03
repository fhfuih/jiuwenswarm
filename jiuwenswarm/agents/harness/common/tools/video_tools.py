# coding: utf-8
# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

from __future__ import annotations

import logging
import asyncio
import base64
import mimetypes
import os
import random
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests
from openjiuwen.core.foundation.tool import tool

from jiuwenswarm.common.config import get_config
from jiuwenswarm.common.utils import env_url, get_agent_workspace_dir, get_config_file
from jiuwenswarm.agents.harness.common.tools.multimodal_config import (
    apply_video_gen_model_config_from_yaml,
    apply_video_model_config_from_yaml,
    _get_model_config,
)
from jiuwenswarm.agents.harness.common.tools.ssl_config import get_requests_verify


logger = logging.getLogger(__name__)
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)
_REQUEST_HEADERS = {
    "User-Agent": _USER_AGENT,
    "Content-Type": "application/json",
}

_SUPPORTED_VIDEO_MODEL_ALIASES = {
    "video_understanding",
    "video_tools.py",
    "jiuwenswarm/agentserver/tools/video_tools.py",
}


def _normalize_video_model_selection(value: str) -> str:
    value = (value or "").strip()
    if value.startswith("@"):
        value = value[1:]
    value = value.replace("\\", "/")
    return value.lower()


def _is_video_model_supported(selection: str) -> bool:
    normalized = _normalize_video_model_selection(selection)
    if not normalized:
        return True
    if normalized in _SUPPORTED_VIDEO_MODEL_ALIASES:
        return True
    return any(normalized.endswith(alias) for alias in _SUPPORTED_VIDEO_MODEL_ALIASES)


@dataclass(frozen=True)
class VideoUnderstandingRequest:
    query: str
    video_path: str
    model: str = "glm-4.6v"
    timeout_seconds: int = 120
    max_tokens: int = 2048
    temperature: float = 0.2
    thinking_enabled: bool = False


def _http_post(url: str, **kwargs) -> requests.Response:
    kwargs.setdefault("verify", get_requests_verify())
    try:
        return requests.post(url, **kwargs)
    except requests.exceptions.ProxyError:
        with requests.Session() as session:
            session.trust_env = False
            return session.post(url, **kwargs)


def _http_get(url: str, **kwargs) -> requests.Response:
    kwargs.setdefault("verify", get_requests_verify())
    try:
        return requests.get(url, **kwargs)
    except requests.exceptions.ProxyError:
        with requests.Session() as session:
            session.trust_env = False
            return session.get(url, **kwargs)


def _guess_video_mime(path: str) -> str:
    mime, _ = mimetypes.guess_type(path)
    if mime and mime.startswith("video/"):
        return mime
    ext = Path(path).suffix.lower()
    mapping = {
        ".mp4": "video/mp4", ".mov": "video/quicktime", ".avi": "video/x-msvideo",
        ".mkv": "video/x-matroska", ".webm": "video/webm", ".mpeg": "video/mpeg",
        ".mpg": "video/mpeg", ".m4v": "video/x-m4v",
    }
    return mapping.get(ext, "video/mp4")


def _video_path_to_url(video_path: str) -> str:
    value = (video_path or "").strip()
    if not value:
        raise ValueError("video_path cannot be empty")
    if value.startswith(("http://", "https://")):
        return value
    path = Path(value).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(f"video file does not exist: {path}")
    if not path.is_file():
        raise ValueError(f"video_path is not a file: {path}")
    mime = _guess_video_mime(str(path))
    with open(path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("utf-8")
    return f"data:{mime};base64,{encoded}"


def _extract_answer(data: dict[str, Any]) -> str:
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    message = first.get("message", {})
    if not isinstance(message, dict):
        return ""
    content = message.get("content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        texts = [str(item.get("text")) for item in content if isinstance(item, dict) and item.get("text")]
        return "\n".join(texts).strip()
    return str(content).strip()


def _normalize_request(inputs: dict[str, Any]) -> VideoUnderstandingRequest:
    query = str(inputs.get("query", "") or "").strip()
    video_path = str(inputs.get("video_path", "") or "").strip()
    default_model = (os.environ.get("VIDEO_MODEL_NAME") or "glm-4.6v").strip() or "glm-4.6v"
    model = str(inputs.get("model", default_model) or default_model).strip()
    timeout_seconds = max(10, min(int(inputs.get("timeout_seconds", 120)), 600))
    max_tokens = max(128, min(int(inputs.get("max_tokens", 2048)), 8192))
    temperature = max(0.0, min(float(inputs.get("temperature", 0.2)), 2.0))
    thinking_enabled = bool(inputs.get("thinking_enabled", False))
    
    if not query:
        raise ValueError("query cannot be empty.")
    if not video_path:
        raise ValueError("video_path cannot be empty.")
    
    return VideoUnderstandingRequest(
        query=query, video_path=video_path, model=model,
        timeout_seconds=timeout_seconds, max_tokens=max_tokens,
        temperature=temperature, thinking_enabled=thinking_enabled,
    )


def _resolve_chat_completions_url(base: str) -> str:
    b = (base or "").strip().rstrip("/")
    if not b:
        return ""
    return b if b.endswith("/chat/completions") else f"{b}/chat/completions"


def _glm_video_understanding_sync(req: VideoUnderstandingRequest) -> str:
    yaml_key = os.environ.get("VIDEO_API_KEY", "").strip()
    yaml_base = os.environ.get("VIDEO_API_BASE", "").strip()
    
    if yaml_key and yaml_base:
        api_key = yaml_key
        api_url = _resolve_chat_completions_url(yaml_base)
    elif yaml_key and not yaml_base:
        raise ValueError("VIDEO_API_BASE is required when VIDEO_API_KEY is set.")
    else:
        api_key = os.environ.get("ZHIPU_API_KEY", "").strip()
        if not api_key:
            raise ValueError(
                f"No video API credentials. Config file: {get_config_file()}\n"
                "Set models.video.model_config with api_key and api_base, or set ZHIPU_API_KEY."
            )
        api_url = env_url("ZHIPU_API_URL", "https://open.bigmodel.cn/api/paas/v4/chat/completions")
    
    video_url = _video_path_to_url(req.video_path)
    
    payload = {
        "model": req.model,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "video_url", "video_url": {"url": video_url}},
                {"type": "text", "text": req.query},
            ],
        }],
        "stream": False,
        "max_tokens": req.max_tokens,
        "temperature": req.temperature,
    }
    
    if req.thinking_enabled:
        payload["thinking"] = {"type": "enabled"}
    
    headers = {**_REQUEST_HEADERS, "Authorization": f"Bearer {api_key}"}
    response = _http_post(api_url, headers=headers, json=payload, timeout=req.timeout_seconds)
    
    if not response.ok:
        try:
            error_data = response.json()
            error_msg = error_data.get("error", {}).get("message", response.text[:200])
        except Exception:
            error_msg = response.text[:200]
        raise ValueError(f"API error {response.status_code}: {error_msg}")
    
    answer = _extract_answer(response.json())
    return answer if answer else "[ERROR]: GLM returned empty answer."


@tool(
    name="video_understanding",
    description=(
        "Analyze and understand video content. "
        "Use this tool when the user provides a video file path (e.g., .mp4, .mov, .avi) "
        "or video URL and asks questions about the video content, such as describing "
        "scenes, actions, people, or objects in the video. "
        "Input: query (question about the video) and video_path (local file path or HTTP/HTTPS URL)."
    ),
)
async def video_understanding(inputs: dict[str, Any], **kwargs) -> str:
    _ = kwargs
    try:
        try:
            apply_video_model_config_from_yaml(get_config())
        except Exception as e:
            logger.warning("[video_understanding] refresh config failed: %s", e)
        req = _normalize_request(inputs or {})
        logger.info(
            "[video_understanding] using model: %s (api_base: %s)",
            req.model, 
            os.environ.get("VIDEO_API_BASE", "")
        )
        return await asyncio.to_thread(_glm_video_understanding_sync, req)
    except Exception as exc:
        return f"[ERROR]: glm video understanding failed: {exc}"


def _normalize_video_size(size: str | None) -> str | None:
    """Normalize size to DashScope ``W*H`` form (also accepts ``WxH``)."""
    if not size:
        return None
    value = str(size).strip().replace("x", "*").replace("X", "*")
    return value or None


def _normalize_video_gen_provider(provider: str, endpoint_profile: str) -> tuple[str, str]:
    """Map legacy DashScope provider to OpenAI + dashscope endpoint profile."""
    profile = (endpoint_profile or "").strip().lower()
    if provider in ("DashScope", "dashscope"):
        return "OpenAI", profile or "dashscope"
    return provider, profile


_MINIMAX_H3_RATIOS: tuple[tuple[int, int], ...] = (
    (21, 9),
    (16, 9),
    (4, 3),
    (1, 1),
    (3, 4),
    (9, 16),
)
_MINIMAX_H3_POLL_INTERVAL_SECONDS = 5.0
# Development pin: all MiniMax Hailuo jobs use H3-Max at 480P / 5s.
_MINIMAX_DEV_MODEL = "MiniMax-H3-Max"
_MINIMAX_DEV_RESOLUTION = "480P"
_MINIMAX_DEV_DURATION = 5


def _is_minimax_h3_model(model: str) -> bool:
    return (model or "").strip().lower().startswith("minimax-h3")


def _is_minimax_h3_max(model: str) -> bool:
    return (model or "").strip().lower() == "minimax-h3-max"


def _minimax_api_origin(api_base: str) -> str:
    parsed = urlparse((api_base or "").strip())
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    raise ValueError(f"invalid MiniMax api_base: {api_base}")


def _minimax_error_message(payload: Any, fallback: str) -> str:
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            message = str(error.get("message") or "").strip()
            if message:
                return message
        if isinstance(error, str) and error.strip():
            return error.strip()
        base_resp = payload.get("base_resp")
        if isinstance(base_resp, dict):
            status_msg = str(base_resp.get("status_msg") or "").strip()
            if status_msg:
                return status_msg
    return fallback


def _size_height(size: str | None) -> int | None:
    normalized = _normalize_video_size(size)
    if not normalized or "*" not in normalized:
        return None
    try:
        _width, height = normalized.split("*", 1)
        value = int(height)
    except ValueError:
        return None
    return value if value > 0 else None


def _minimax_h3_ratio(size: str | None) -> str:
    normalized = _normalize_video_size(size) or "854*480"
    try:
        width_s, height_s = normalized.split("*", 1)
        width, height = int(width_s), int(height_s)
    except ValueError:
        return "16:9"
    if width <= 0 or height <= 0:
        return "16:9"
    target = width / height
    best = min(_MINIMAX_H3_RATIOS, key=lambda item: abs((item[0] / item[1]) - target))
    return f"{best[0]}:{best[1]}"


def _minimax_h3_resolution(model: str, size: str | None, resolution: str | None) -> str:
    if _is_minimax_h3_model(model):
        return _MINIMAX_DEV_RESOLUTION
    raw = (resolution or "").strip().upper().replace(" ", "")
    aliases = {
        "480": "480P",
        "480P": "480P",
        "768": "768P",
        "768P": "768P",
        "2K": "2K",
    }
    if raw in aliases:
        chosen = aliases[raw]
    else:
        height = _size_height(size)
        if height and height <= 540:
            chosen = "480P"
        elif height and height >= 1440:
            chosen = "2K"
        else:
            chosen = "768P"
    return chosen if chosen in {"768P", "2K"} else "768P"


def _minimax_h3_duration(model: str, duration: int) -> int:
    if _is_minimax_h3_model(model):
        return _MINIMAX_DEV_DURATION
    value = int(duration or 5)
    return max(4, min(value, 15))


def _image_path_to_data_uri(path: str | Path) -> str:
    file_path = Path(path)
    mime, _ = mimetypes.guess_type(str(file_path))
    if not mime or not mime.startswith("image/"):
        suffix = file_path.suffix.lower()
        mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(
            suffix, "image/png"
        )
    encoded = base64.b64encode(file_path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _minimax_image_url(value: str) -> str:
    text = (value or "").strip()
    if text.startswith(("http://", "https://", "data:", "mm_file://")):
        return text
    return _image_path_to_data_uri(text)


def _minimax_h3_payload(
    prompt: str,
    *,
    model: str,
    size: str | None,
    duration: int,
    resolution: str | None,
    first_frame: str | None = None,
    reference_images: list[str] | None = None,
) -> dict[str, Any]:
    text = (prompt or "").strip()
    if not text:
        raise ValueError("prompt cannot be empty.")
    refs = [str(item).strip() for item in (reference_images or []) if str(item).strip()]
    frame = (first_frame or "").strip()
    # MiniMax: first/last-frame I2V and reference-to-video cannot be mixed.
    # H3-Max cannot do reference-to-video, so character+keyframe must use H3.
    if refs:
        if frame and frame not in refs:
            refs = [frame, *refs]
        frame = ""
        pinned_model = "MiniMax-H3"
        chosen_resolution = "768P"
        ratio = "adaptive"
    else:
        pinned_model = _MINIMAX_DEV_MODEL if _is_minimax_h3_model(model) else model.strip()
        chosen_resolution = _minimax_h3_resolution(pinned_model, size, resolution)
        ratio = "adaptive" if frame else _minimax_h3_ratio(size)
    content: list[dict[str, Any]] = [{"type": "text", "text": text}]
    if frame:
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": _minimax_image_url(frame)},
                "role": "first_frame",
            }
        )
    for ref in refs[:9]:
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": _minimax_image_url(ref)},
                "role": "reference_image",
            }
        )
    return {
        "model": pinned_model,
        "content": content,
        "resolution": chosen_resolution,
        "duration": _minimax_h3_duration(pinned_model, duration),
        "ratio": ratio,
    }


def _new_generated_video_path() -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    random_suffix = random.randint(1000, 9999)
    return get_agent_workspace_dir() / f"generated_{timestamp}_{random_suffix}.mp4"


async def _invoke_minimax_h3_video_generation(
    prompt: str,
    *,
    api_key: str,
    api_base: str,
    model: str,
    size: str,
    duration: int,
    resolution: str | None,
    timeout: int,
    first_frame: str | None = None,
    reference_images: list[str] | None = None,
) -> dict[str, Any]:
    """Create a MiniMax H3 / H3-Max task, poll it, then download the mp4."""
    origin = _minimax_api_origin(api_base)
    payload = _minimax_h3_payload(
        prompt,
        model=model,
        size=size,
        duration=duration,
        resolution=resolution,
        first_frame=first_frame,
        reference_images=reference_images,
    )
    headers = {**_REQUEST_HEADERS, "Authorization": f"Bearer {api_key}"}
    create_url = f"{origin}/v2/video_generation"
    ref_count = sum(1 for item in payload["content"] if item.get("role") == "reference_image")
    logger.info(
        "[generate_video] MiniMax H3 create model=%s resolution=%s duration=%s ratio=%s first_frame=%s reference_images=%s",
        payload["model"],
        payload["resolution"],
        payload["duration"],
        payload["ratio"],
        any(item.get("role") == "first_frame" for item in payload["content"]),
        ref_count,
    )

    create_response = await asyncio.to_thread(
        _http_post,
        create_url,
        headers=headers,
        json=payload,
        timeout=min(60, max(10, timeout)),
    )
    try:
        create_body = create_response.json()
    except Exception:
        create_body = {}
    if not create_response.ok:
        return {
            "error": (
                "[ERROR]: MiniMax video create failed "
                f"{create_response.status_code}: "
                f"{_minimax_error_message(create_body, create_response.text[:200])}"
            )
        }
    task_id = str((create_body or {}).get("task_id") or "").strip()
    if not task_id:
        return {"error": "[ERROR]: MiniMax video create returned no task_id"}

    query_url = f"{origin}/v2/query/video_generation/{task_id}"
    deadline = time.monotonic() + max(30, timeout)
    task: dict[str, Any] = {}
    while time.monotonic() < deadline:
        query_response = await asyncio.to_thread(
            _http_get,
            query_url,
            headers=headers,
            timeout=30,
        )
        try:
            query_body = query_response.json()
        except Exception:
            query_body = {}
        if not query_response.ok:
            return {
                "error": (
                    "[ERROR]: MiniMax video query failed "
                    f"{query_response.status_code}: "
                    f"{_minimax_error_message(query_body, query_response.text[:200])}"
                )
            }
        raw_task = query_body.get("task") if isinstance(query_body, dict) else None
        task = raw_task if isinstance(raw_task, dict) else {}
        status = str(task.get("status") or "").strip().lower()
        if status == "succeeded":
            break
        if status in {"failed", "cancelled"}:
            error = task.get("error") if isinstance(task.get("error"), dict) else {}
            message = str(error.get("message") or status).strip()
            code = str(error.get("code") or "").strip()
            detail = f"{message} ({code})" if code else message
            return {"error": f"[ERROR]: MiniMax video task {status}: {detail}"}
        await asyncio.sleep(_MINIMAX_H3_POLL_INTERVAL_SECONDS)
    else:
        return {"error": f"[ERROR]: MiniMax video task timed out (task_id={task_id})"}

    content = task.get("content") if isinstance(task.get("content"), dict) else {}
    video_url = str(content.get("url") or "").strip()
    if not video_url:
        return {"error": "[ERROR]: MiniMax video task succeeded but returned no url"}

    output_path = _new_generated_video_path()
    download = await asyncio.to_thread(
        _http_get,
        video_url,
        headers={"User-Agent": _USER_AGENT},
        timeout=300,
    )
    download.raise_for_status()
    output_path.write_bytes(download.content)
    return {
        "video_path": str(output_path.absolute()),
        "revised_prompt": prompt,
        "original_url": video_url,
    }


async def _invoke_model_video_generation(
    prompt: str,
    *,
    size: str = "854*480",
    duration: int = 5,
    resolution: str | None = "480P",
    first_frame: str | None = None,
    reference_images: list[str] | None = None,
) -> dict[str, Any]:
    """Generate a video via the same Model client stack as image generation."""
    from openjiuwen.core.foundation.llm import (
        Model,
        ModelClientConfig,
        ModelRequestConfig,
        UserMessage,
    )

    cfg = get_config() or {}
    mc = _get_model_config(cfg, "video_gen")
    image_mc = _get_model_config(cfg, "image_gen")

    api_key = str(
        mc.get("api_key")
        or os.getenv("VIDEO_GEN_API_KEY")
        or image_mc.get("api_key")
        or os.getenv("IMAGE_GEN_API_KEY")
        or os.getenv("API_KEY")
        or ""
    ).strip()
    api_base = str(
        mc.get("api_base")
        or os.getenv("VIDEO_GEN_API_BASE")
        or image_mc.get("api_base")
        or os.getenv("IMAGE_GEN_API_BASE")
        or os.getenv("API_BASE")
        or "https://dashscope.aliyuncs.com/api/v1"
    ).strip()
    if not api_key:
        return {
            "error": (
                "[ERROR]: VIDEO_GEN_API_KEY / IMAGE_GEN_API_KEY / API_KEY "
                "is not configured for video generation."
            )
        }

    model = str(
        mc.get("model_name")
        or mc.get("model")
        or os.getenv("VIDEO_GEN_MODEL_NAME")
        or "wan2.6-t2v"
    ).strip()
    provider = str(
        mc.get("client_provider")
        or mc.get("model_provider")
        or os.getenv("VIDEO_GEN_PROVIDER")
        or image_mc.get("client_provider")
        or image_mc.get("model_provider")
        or os.getenv("IMAGE_GEN_PROVIDER")
        or "DashScope"
    ).strip()
    endpoint_profile = str(
        mc.get("endpoint_profile")
        or os.getenv("VIDEO_GEN_ENDPOINT_PROFILE")
        or image_mc.get("endpoint_profile")
        or ""
    ).strip()
    provider, endpoint_profile = _normalize_video_gen_provider(provider, endpoint_profile)

    if _is_minimax_h3_model(model):
        try:
            timeout = int(mc.get("timeout", image_mc.get("timeout", 1800)) or 1800)
            return await _invoke_minimax_h3_video_generation(
                prompt,
                api_key=api_key,
                api_base=api_base,
                model=model,
                size=size,
                duration=duration,
                resolution=resolution,
                timeout=timeout,
                first_frame=first_frame,
                reference_images=reference_images,
            )
        except Exception as ex:
            return {"error": f"[ERROR]: MiniMax video generation failed: {ex}"}

    try:
        mcc_kwargs: dict[str, Any] = dict(
            client_id="video_gen_client",
            client_provider=provider,
            api_key=api_key,
            api_base=api_base,
            verify_ssl=mc.get("verify_ssl", image_mc.get("verify_ssl", True)),
            ssl_cert=mc.get("ssl_cert", image_mc.get("ssl_cert")),
            timeout=mc.get("timeout", image_mc.get("timeout", 1800)),
        )
        if endpoint_profile:
            mcc_kwargs["endpoint_profile"] = endpoint_profile
        model_client_config = ModelClientConfig(**mcc_kwargs)
        model_config = ModelRequestConfig(model=model)
        model_instance = Model(
            model_config=model_config,
            model_client_config=model_client_config,
        )
        messages = [UserMessage(content=prompt)]
        normalized_size = _normalize_video_size(size)

        result = await model_instance.generate_video(
            messages=messages,
            model=model,
            size=normalized_size,
            resolution=resolution,
            duration=duration,
        )

        output_dir = get_agent_workspace_dir()
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        random_suffix = random.randint(1000, 9999)
        output_path = output_dir / f"generated_{timestamp}_{random_suffix}.mp4"

        video_url = getattr(result, "video_url", None)
        video_data = getattr(result, "video_data", None)

        if video_data:
            with open(output_path, "wb") as f:
                f.write(video_data)
            return {
                "video_path": str(output_path.absolute()),
                "revised_prompt": prompt,
            }

        if video_url:
            response = requests.get(
                video_url,
                headers={"User-Agent": _USER_AGENT},
                verify=get_requests_verify(),
                timeout=300,
            )
            response.raise_for_status()
            with open(output_path, "wb") as f:
                f.write(response.content)
            return {
                "video_path": str(output_path.absolute()),
                "revised_prompt": prompt,
                "original_url": video_url,
            }

        return {"error": "[ERROR]: No valid video data in response"}
    except Exception as ex:
        return {"error": f"[ERROR]: Video generation failed: {ex}"}


@tool(
    name="generate_video",
    description=(
        "Generate a video from a text description using AI video generation models. "
        "Use this tool when the user wants to create a short video / clip / animation "
        "based on a text prompt. Returns the path to the saved generated video file."
    ),
)
async def generate_video(
    prompt: str,
    size: str = "854*480",
    duration: int = 5,
    resolution: str | None = "480P",
    save_dir: str | None = None,
) -> str:
    """Generate a video from a text description and save it to the workspace."""
    try:
        apply_video_gen_model_config_from_yaml(get_config())
    except Exception:
        logger.debug("Failed to apply video_gen model config from yaml", exc_info=True)

    model = (os.environ.get("VIDEO_GEN_MODEL_NAME") or "wan2.6-t2v").strip()
    provider = (os.environ.get("VIDEO_GEN_PROVIDER") or "DashScope").strip()
    logger.info(
        "[generate_video] using model: %s, provider: %s, size: %s, duration: %s",
        model,
        provider,
        size,
        duration,
    )

    result = await _invoke_model_video_generation(
        prompt,
        size=size,
        duration=max(1, min(int(duration or 5), 15)),
        resolution=resolution,
    )
    if "error" in result:
        return result["error"]

    video_path = result["video_path"]
    if save_dir:
        save_path = Path(save_dir)
        save_path.mkdir(parents=True, exist_ok=True)
        new_path = save_path / Path(video_path).name
        Path(video_path).rename(new_path)
        video_path = str(new_path.absolute())

    response_parts = [
        "Video generated successfully!",
        f"Saved to: {video_path}",
        f"Prompt: {prompt}",
    ]
    original_url = result.get("original_url", "")
    if original_url:
        response_parts.append(f"Original URL: {original_url}")
    return "\n".join(response_parts)
