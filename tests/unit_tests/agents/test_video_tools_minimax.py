# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

from __future__ import annotations

import json
from pathlib import Path

import pytest

from jiuwenswarm.agents.harness.common.tools import video_tools


class _FakeResponse:
    def __init__(self, payload: object, status_code: int = 200, text: str = "", content: bytes = b"") -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text or (json.dumps(payload) if isinstance(payload, dict) else "")
        self.content = content or self.text.encode("utf-8")

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> object:
        return self._payload

    def raise_for_status(self) -> None:
        if not self.ok:
            raise RuntimeError(f"HTTP {self.status_code}")


def test_minimax_origin_strips_openai_v1_path() -> None:
    assert video_tools._minimax_api_origin("https://api.minimaxi.com/v1") == "https://api.minimaxi.com"
    assert video_tools._minimax_api_origin("https://api.minimax.cn/v1/") == "https://api.minimax.cn"


def test_minimax_h3_max_clamps_resolution_and_duration() -> None:
    payload = video_tools._minimax_h3_payload(
        "a boy playing basketball on the beach",
        model="MiniMax-H3-Max",
        size="2560*1440",
        duration=15,
        resolution="2K",
    )
    assert payload["model"] == "MiniMax-H3-Max"
    assert payload["resolution"] == "480P"
    assert payload["duration"] == 5
    assert payload["ratio"] == "16:9"
    assert payload["content"] == [
        {"type": "text", "text": "a boy playing basketball on the beach"},
    ]


def test_minimax_h3_is_pinned_to_h3_max_480p() -> None:
    payload = video_tools._minimax_h3_payload(
        "epic space opera",
        model="MiniMax-H3",
        size="2560*1440",
        duration=4,
        resolution="2K",
    )
    assert payload["model"] == "MiniMax-H3-Max"
    assert payload["resolution"] == "480P"
    assert payload["duration"] == 5


def test_minimax_h3_payload_uses_first_frame_as_i2v(tmp_path: Path) -> None:
    image = tmp_path / "keyframe.png"
    image.write_bytes(b"\x89PNG\r\n\x1a\n")
    payload = video_tools._minimax_h3_payload(
        "follow the keyframe",
        model="MiniMax-H3-Max",
        size="854*480",
        duration=5,
        resolution="480P",
        first_frame=str(image),
    )
    assert payload["ratio"] == "adaptive"
    assert payload["content"][0] == {"type": "text", "text": "follow the keyframe"}
    frame = payload["content"][1]
    assert frame["type"] == "image_url"
    assert frame["role"] == "first_frame"
    assert frame["image_url"]["url"].startswith("data:image/png;base64,")


def test_minimax_h3_payload_uses_reference_images_as_r2va(tmp_path: Path) -> None:
    frame = tmp_path / "keyframe.png"
    character = tmp_path / "character.png"
    frame.write_bytes(b"\x89PNG\r\n\x1a\n")
    character.write_bytes(b"\x89PNG\r\n\x1a\n")
    payload = video_tools._minimax_h3_payload(
        "keep the character and start from the keyframe",
        model="MiniMax-H3-Max",
        size="854*480",
        duration=5,
        resolution="480P",
        first_frame=str(frame),
        reference_images=[str(character)],
    )
    assert payload["model"] == "MiniMax-H3"
    assert payload["resolution"] == "768P"
    assert payload["duration"] == 5
    assert payload["ratio"] == "adaptive"
    roles = [item.get("role") for item in payload["content"] if item.get("type") == "image_url"]
    assert roles == ["reference_image", "reference_image"]
    assert all(
        item["image_url"]["url"].startswith("data:image/png;base64,")
        for item in payload["content"]
        if item.get("type") == "image_url"
    )


def test_minimax_ratio_follows_portrait_size() -> None:
    assert video_tools._minimax_h3_ratio("720*1280") == "9:16"
    assert video_tools._minimax_h3_ratio("1024*1024") == "1:1"


@pytest.mark.asyncio
async def test_minimax_h3_max_create_poll_and_download(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    calls: list[tuple[str, str]] = []

    def fake_post(url: str, **kwargs):
        calls.append(("POST", url))
        assert url == "https://api.minimaxi.com/v2/video_generation"
        assert kwargs["json"]["model"] == "MiniMax-H3-Max"
        assert kwargs["json"]["resolution"] == "480P"
        assert kwargs["headers"]["Authorization"] == "Bearer test-key"
        return _FakeResponse({"task_id": "424010985738629"})

    query_payloads = [
        _FakeResponse({"task": {"id": "424010985738629", "status": "running"}}),
        _FakeResponse(
            {
                "task": {
                    "id": "424010985738629",
                    "status": "succeeded",
                    "content": {"url": "https://cdn.example.com/out.mp4"},
                }
            }
        ),
    ]

    def fake_get(url: str, **kwargs):
        calls.append(("GET", url))
        if url.endswith("/v2/query/video_generation/424010985738629"):
            return query_payloads.pop(0)
        if url == "https://cdn.example.com/out.mp4":
            return _FakeResponse({}, content=b"mp4-bytes")
        raise AssertionError(f"unexpected GET {url}")

    monkeypatch.setattr(video_tools, "_http_post", fake_post)
    monkeypatch.setattr(video_tools, "_http_get", fake_get)
    monkeypatch.setattr(video_tools, "_MINIMAX_H3_POLL_INTERVAL_SECONDS", 0)
    monkeypatch.setattr(video_tools, "get_agent_workspace_dir", lambda: tmp_path)
    monkeypatch.setattr(video_tools, "get_config", lambda: {})
    monkeypatch.setenv("VIDEO_GEN_API_KEY", "test-key")
    monkeypatch.setenv("VIDEO_GEN_API_BASE", "https://api.minimaxi.com/v1")
    monkeypatch.setenv("VIDEO_GEN_MODEL_NAME", "MiniMax-H3-Max")
    monkeypatch.setenv("VIDEO_GEN_PROVIDER", "OpenAI")

    result = await video_tools._invoke_model_video_generation(
        "a boy playing basketball on the beach",
        size="854*480",
        duration=5,
        resolution="480P",
    )

    assert "error" not in result
    saved = Path(result["video_path"])
    assert saved.exists()
    assert saved.read_bytes() == b"mp4-bytes"
    assert result["original_url"] == "https://cdn.example.com/out.mp4"
    assert ("POST", "https://api.minimaxi.com/v2/video_generation") in calls
    assert any(url.endswith("/v2/query/video_generation/424010985738629") for method, url in calls if method == "GET")


@pytest.mark.asyncio
async def test_minimax_h3_create_error_is_surfaced(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_post(url: str, **kwargs):
        return _FakeResponse(
            {"type": "error", "error": {"type": "insufficient_balance_error", "message": "insufficient balance (1008)"}},
            status_code=402,
        )

    monkeypatch.setattr(video_tools, "_http_post", fake_post)
    monkeypatch.setattr(video_tools, "get_config", lambda: {})
    monkeypatch.setenv("VIDEO_GEN_API_KEY", "test-key")
    monkeypatch.setenv("VIDEO_GEN_API_BASE", "https://api.minimaxi.com/v1")
    monkeypatch.setenv("VIDEO_GEN_MODEL_NAME", "MiniMax-H3-Max")

    result = await video_tools._invoke_model_video_generation("prompt")
    assert result["error"].startswith("[ERROR]: MiniMax video create failed 402")
    assert "insufficient balance" in result["error"]
