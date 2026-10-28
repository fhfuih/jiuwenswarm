# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""Designer chat-model calls send only the thinking switch each provider honors."""

from __future__ import annotations

import pytest

from jiuwenswarm.server.runtime.designer.model_tools import _thinking_disabled_extra_body


@pytest.mark.parametrize(
    ("api_base", "model_name"),
    [
        ("https://api.deepseek.com", "deepseek-v4-flash"),
        ("https://api.deepseek.com/v1", "DeepSeek-V4.1-Flash"),
        ("https://open.bigmodel.cn/api/paas/v4", "glm-5.1"),
        ("https://dashscope.aliyuncs.com/compatible-mode/v1", "GLM-5.3-Flash"),
        ("https://dashscope.aliyuncs.com/compatible-mode/v1", "deepseek-v4-pro"),
        ("http://10.0.0.8:4000/v1", "glm-5.3-flash"),
        ("", "unknown-model"),
    ],
)
def test_default_uses_thinking_type_only(api_base: str, model_name: str) -> None:
    assert _thinking_disabled_extra_body(api_base, model_name) == {"thinking": {"type": "disabled"}}


@pytest.mark.parametrize(
    ("api_base", "model_name"),
    [
        ("https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen3-max"),
        ("https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus"),
        ("http://127.0.0.1:8000/v1", "Qwen/Qwen3-32B"),
    ],
)
def test_qwen_uses_enable_thinking_only(api_base: str, model_name: str) -> None:
    assert _thinking_disabled_extra_body(api_base, model_name) == {"enable_thinking": False}


def test_qwen_thinking_only_model_does_not_get_enable_thinking() -> None:
    body = _thinking_disabled_extra_body(
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "qwen3-vl-plus-thinking",
    )
    assert body == {"thinking": {"type": "disabled"}}


@pytest.mark.parametrize(
    ("api_base", "model_name"),
    [
        ("https://openrouter.ai/api/v1", "deepseek/deepseek-v4-pro"),
        ("openrouter.ai/api/v1", "qwen/qwen3.8-max"),
    ],
)
def test_openrouter_uses_reasoning_enabled_only(api_base: str, model_name: str) -> None:
    assert _thinking_disabled_extra_body(api_base, model_name) == {"reasoning": {"enabled": False}}


def test_never_sends_multiple_or_template_switches() -> None:
    """Regression: an always-thinking model behind a DashScope proxy rejects enable_thinking=false."""
    body = _thinking_disabled_extra_body("https://dashscope.aliyuncs.com/compatible-mode/v1", "GLM-5.3-Flash")
    assert "enable_thinking" not in body
    assert "chat_template_kwargs" not in body
    assert len(body) == 1
