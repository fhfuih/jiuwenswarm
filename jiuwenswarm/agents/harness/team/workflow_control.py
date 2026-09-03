"""Read the editable SwarmFlow dispatch overlay (decoupled from a run snapshot).

Scripts keep using ``phase`` / ``agent`` / ``parallel``. User edits from the
Web workflow panel are stored as SwarmFlow-shaped relations that map onto
scheduled dispatch: sequence → depends_on, parallel → same-wave unlock,
review → reviewer + max_review_rounds.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def load_workflow_control(session_id: str | None = None) -> dict[str, Any]:
    """Load saved control specs, keyed by workflow run id / script name."""
    sid = (session_id or os.environ.get("JIUWENSWARM_SESSION_ID") or "").strip()
    if sid:
        try:
            from jiuwenswarm.server.runtime.agent_adapter.team_helpers import (
                restore_workflow_control,
            )

            stored = restore_workflow_control(sid)
            if stored:
                return stored
        except Exception:
            pass

    for candidate in _sidecar_candidates():
        if not candidate.is_file():
            continue
        try:
            raw = json.loads(candidate.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(raw, dict) and raw:
            return raw
    return {}


def first_spec(controls: dict[str, Any]) -> dict[str, Any]:
    for value in controls.values():
        if isinstance(value, dict):
            return value
    return {}


def enabled_reviews(spec: dict[str, Any]) -> list[dict[str, Any]]:
    """Review relations in the user-specified scheduled order."""
    relations = [item for item in spec.get("relations") or [] if isinstance(item, dict)]
    reviews = [item for item in relations if item.get("kind") == "review" and item.get("enabled", True)]
    order = spec.get("reviewOrder") or spec.get("review_order") or []
    by_id = {str(item.get("id")): item for item in reviews}
    ordered = [by_id[rid] for rid in order if rid in by_id]
    leftover = [item for item in reviews if str(item.get("id")) not in set(order)]
    return ordered + leftover


def first_reviewer_role(spec: dict[str, Any]) -> str:
    """Best-effort role for the first scheduled review: storyboard | keyframes."""
    reviews = enabled_reviews(spec)
    if not reviews:
        return "storyboard"
    label = str(reviews[0].get("label") or "").strip()
    if label.startswith("关键帧") or label.lower().startswith("keyframe"):
        return "keyframes"
    return "storyboard"


def max_review_rounds(spec: dict[str, Any], default: int = 1) -> int:
    reviews = enabled_reviews(spec)
    if not reviews:
        return default
    rounds = [int(item.get("maxReviewRounds") or item.get("max_review_rounds") or default) for item in reviews]
    return max(rounds) if rounds else default


def _sidecar_candidates() -> list[Path]:
    here = Path.cwd()
    names = ("workflow-control.json",)
    found: list[Path] = []
    for parent in [here, *here.parents]:
        swarmflow = parent / "swarmflow"
        for name in names:
            found.append(swarmflow / name)
            found.append(parent / name)
        if parent.name == "team-workspace" or parent.name == ".agent_teams":
            break
    script_dir = Path(__file__).resolve()
    found.append(script_dir.with_name("workflow-control.json"))
    return found
