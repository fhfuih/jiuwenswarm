# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

from __future__ import annotations

import json
from pathlib import Path

from jiuwenswarm.agents.harness.common.tools import image_tools


class _FakeResponse:
    def __init__(self, payload: object, status_code: int = 200) -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload) if isinstance(payload, dict) else ""
        self.content = self.text.encode("utf-8")

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> object:
        return self._payload


def test_dashscope_qwen_img2img_posts_reference_images(tmp_path: Path, monkeypatch) -> None:
    character = tmp_path / "character.png"
    scene = tmp_path / "scene.png"
    character.write_bytes(b"\x89PNG\r\n\x1a\n")
    scene.write_bytes(b"\x89PNG\r\n\x1a\n")
    seen: dict[str, object] = {}

    def fake_post(url: str, **kwargs):
        seen["url"] = url
        seen["payload"] = kwargs["json"]
        return _FakeResponse(
            {
                "output": {
                    "choices": [
                        {"message": {"content": [{"image": "https://cdn.example.com/frame.png"}]}}
                    ]
                }
            }
        )

    def fake_get(url: str, **kwargs):
        class _Download:
            def raise_for_status(self) -> None:
                return None

            @property
            def content(self) -> bytes:
                return b"png-bytes"

        return _Download()

    monkeypatch.setattr(image_tools, "get_agent_workspace_dir", lambda: tmp_path)
    monkeypatch.setattr(image_tools.requests, "post", fake_post)
    monkeypatch.setattr(image_tools.requests, "get", fake_get)

    result = image_tools._invoke_dashscope_image_to_image(
        "compose the character into the scene",
        api_key="test-key",
        api_base="https://dashscope.aliyuncs.com/api/v1",
        model="qwen-image-3.0",
        reference_images=[str(character), str(scene)],
        timeout=30,
    )
    assert "error" not in result
    assert Path(result["image_path"]).read_bytes() == b"png-bytes"
    assert str(seen["url"]).endswith("/services/aigc/multimodal-generation/generation")
    content = seen["payload"]["input"]["messages"][0]["content"]
    assert content[0]["image"].startswith("data:image/png;base64,")
    assert content[1]["image"].startswith("data:image/png;base64,")
    assert content[2]["text"] == "compose the character into the scene"
