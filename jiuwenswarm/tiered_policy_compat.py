# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""Re-export ``_parse_level`` on the openjiuwen ``tiered_policy`` shim.

``openjiuwen.harness.security.tiered_policy`` is now a star-import wrapper of
``tool_policy``. Python ``import *`` does not copy names that start with ``_``,
but ``openjiuwen.agent_teams.security.narrowing`` still does:

    from openjiuwen.harness.security.tiered_policy import _parse_level, strictest

That ImportError aborts Team harness setup (permission rails). Inject the
helper onto the shim before narrowing is imported.
"""

from __future__ import annotations

import logging

logger = logging.getLogger("jiuwenswarm.tiered_policy_compat")

_PATCH_APPLIED = False


def apply_tiered_policy_parse_level_compat() -> None:
    """Make ``from ...tiered_policy import _parse_level`` succeed."""
    global _PATCH_APPLIED
    if _PATCH_APPLIED:
        return
    try:
        from openjiuwen.harness.security.permission_engine.toolguard.tool_policy import (
            _parse_level,
        )
        import openjiuwen.harness.security.tiered_policy as tiered_policy
    except ImportError as exc:
        logger.debug("[tiered_policy_compat] skip: %s", exc)
        return

    if getattr(tiered_policy, "_parse_level", None) is not _parse_level:
        tiered_policy._parse_level = _parse_level
        logger.info(
            "[tiered_policy_compat] re-exported _parse_level on tiered_policy shim"
        )
    _PATCH_APPLIED = True
