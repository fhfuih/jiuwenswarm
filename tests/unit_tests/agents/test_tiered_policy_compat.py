# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""Compat patch for openjiuwen.harness.security.tiered_policy._parse_level."""

from __future__ import annotations

from jiuwenswarm.tiered_policy_compat import apply_tiered_policy_parse_level_compat


def test_tiered_policy_shim_exports_parse_level_after_compat_patch() -> None:
    apply_tiered_policy_parse_level_compat()
    from openjiuwen.harness.security.permission_engine.toolguard.tool_policy import (
        _parse_level as canonical,
    )
    from openjiuwen.harness.security.tiered_policy import _parse_level, strictest
    from openjiuwen.agent_teams.security.narrowing import (
        format_base_permissions_for_desc,
        narrow_permissions,
    )

    assert _parse_level is canonical
    assert callable(strictest)
    assert callable(narrow_permissions)
    assert callable(format_base_permissions_for_desc)
