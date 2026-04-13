"""Independent refined resume draft: separate files under case_runtime/refined/, never overwrites working draft."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .product_constants import PROMPT_VERSION
from .schema_definitions import RefinedResumePayload


def refined_runtime_dir(runtime: Path) -> Path:
    return runtime / "refined"


def new_refined_id() -> str:
    return "rf_" + uuid.uuid4().hex[:12]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def hash_text(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def summarize_excerpt(text: str, max_chars: int = 480) -> str:
    t = (text or "").strip()
    if len(t) <= max_chars:
        return t
    return t[: max_chars - 1] + "…"


def build_accepted_applied_summary(suggestion_items: List[Dict[str, Any]]) -> str:
    """Human-readable lines for prompt: accepted / applied suggestions."""
    lines: List[str] = []
    for s in suggestion_items or []:
        st = s.get("status")
        ap = s.get("applied_to_draft")
        if st == "accepted" or ap:
            tag = []
            if st:
                tag.append(f"状态:{st}")
            if ap:
                tag.append("已应用")
            lines.append(f"- [{', '.join(tag)}] {s.get('category', '')}: {s.get('text', '')}")
    return "\n".join(lines) if lines else "（尚无已采纳/已应用建议记录）"


def messages_refined_resume(
    *,
    working_draft_markdown: str,
    goal_mode: str,
    missing_inputs: List[str],
    suggestion_summary: str,
) -> List[Dict[str, str]]:
    """LLM messages for JSON RefinedResumePayload."""
    miss = "\n".join(f"- {x}" for x in (missing_inputs or [])) or "（按规则无强制缺口）"
    body = working_draft_markdown
    max_chars = 24000
    if len(body) > max_chars:
        body = body[:max_chars] + "\n\n[… 工作稿过长已截断，请仅基于以上部分润色 …]"

    system = f"""你是中文简历润色助手，输出单个 JSON 对象（不要 Markdown 围栏）。
【硬性规则】
1. 输入为「当前简历工作稿」Markdown，你必须输出 refined_resume_markdown：在保留事实的前提下改写得更像可投递版本（结构清晰、动词有力、减少口语）。
2. 不得编造未在原文出现的经历、数据、公司名；若原文某段为空或占位，可略作版式整理但不要虚构内容。
3. refinement_focus 写 3～7 条短句，说明本次润色分别改了什么（例如：量化表述、统一时态、压缩冗余）。
4. polish_notes 用 1～2 句提醒用户：这是建议润色稿，需人工确认后再投递；不是最终定稿。
5. 目标模式 goal_mode 为 {goal_mode}：若为 delivery 偏投递可读性；interview 可略保留故事线；both 平衡。
【输出 JSON 键】refined_resume_markdown, refinement_focus (string array), polish_notes (string)
【提示版本】{PROMPT_VERSION}
"""

    user = f"""【当前缺口提示】
{miss}

【已采纳/已应用建议摘要】
{suggestion_summary}

【当前简历工作稿 Markdown】
{body}
"""

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def save_refined_artifacts(
    runtime: Path,
    refined_id: str,
    payload: RefinedResumePayload,
    *,
    based_on_generation_id: Optional[str],
    working_draft_sha256: str,
    model_name: str,
    goal_mode: str,
) -> Tuple[Path, Path, Dict[str, Any]]:
    """Write .md + .meta.json + latest.json. Returns (md_path, meta_path, meta)."""
    rdir = refined_runtime_dir(runtime)
    rdir.mkdir(parents=True, exist_ok=True)

    md_path = rdir / f"{refined_id}.md"
    meta_path = rdir / f"{refined_id}.meta.json"

    md_body = payload.refined_resume_markdown.strip()
    # Visible banner in file (user-openable); still machine-readable as markdown
    banner = (
        f"<!-- refined_draft_id={refined_id} | 建议润色稿，非最终定稿 | "
        f"based_on_generation={based_on_generation_id or 'none'} -->\n\n"
    )
    md_path.write_text(banner + md_body + "\n", encoding="utf-8")

    meta: Dict[str, Any] = {
        "refined_id": refined_id,
        "based_on_generation_id": based_on_generation_id,
        "based_on_working_draft_sha256": working_draft_sha256,
        "model_name": model_name,
        "prompt_version": PROMPT_VERSION,
        "generated_at": _utc_now_iso(),
        "goal_mode": goal_mode,
        "refinement_focus": payload.refinement_focus,
        "polish_notes": payload.polish_notes,
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    payload_path = rdir / f"{refined_id}.payload.json"
    payload_path.write_text(
        json.dumps(payload.model_dump(mode="json"), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    latest = rdir / "latest.json"
    latest.write_text(
        json.dumps(
            {
                "refined_id": refined_id,
                "generated_at": meta["generated_at"],
                "based_on_generation_id": based_on_generation_id,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    return md_path, meta_path, meta


def load_latest_refined(runtime: Path) -> Optional[Dict[str, Any]]:
    rdir = refined_runtime_dir(runtime)
    latest = rdir / "latest.json"
    if not latest.exists():
        return None
    try:
        lid = json.loads(latest.read_text(encoding="utf-8")).get("refined_id")
    except Exception:
        return None
    if not lid:
        return None
    return load_refined_by_id(runtime, lid)


def load_refined_by_id(runtime: Path, refined_id: str) -> Optional[Dict[str, Any]]:
    rdir = refined_runtime_dir(runtime)
    meta_path = rdir / f"{refined_id}.meta.json"
    md_path = rdir / f"{refined_id}.md"
    if not meta_path.exists() or not md_path.exists():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    raw_md = read_text_safe(md_path)
    return {
        "refined_id": refined_id,
        "meta": meta,
        "markdown": raw_md,
        "markdown_body": strip_refined_banner(raw_md),
    }


def read_text_safe(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def strip_refined_banner(text: str) -> str:
    lines = (text or "").splitlines()
    if lines and lines[0].strip().startswith("<!-- refined_draft_id="):
        return "\n".join(lines[1:]).lstrip("\n")
    return text or ""


def build_compare_summary(
    *,
    working_draft_markdown: str,
    refined_markdown_body: str,
    meta: Dict[str, Any],
) -> Dict[str, Any]:
    """Lightweight comparison for API (no LLM): excerpts + stats + focus from meta."""
    w = working_draft_markdown or ""
    r = refined_markdown_body or ""
    return {
        "working_draft_excerpt": summarize_excerpt(w, 520),
        "refined_draft_excerpt": summarize_excerpt(r, 520),
        "refinement_focus": meta.get("refinement_focus") or [],
        "polish_notes": meta.get("polish_notes") or "",
        "stats": {
            "working_chars": len(w),
            "refined_chars": len(r),
            "working_lines": w.count("\n") + (1 if w else 0),
            "refined_lines": r.count("\n") + (1 if r else 0),
        },
        "meta": {
            "refined_id": meta.get("refined_id"),
            "based_on_generation_id": meta.get("based_on_generation_id"),
            "based_on_working_draft_sha256": meta.get("based_on_working_draft_sha256"),
            "model_name": meta.get("model_name"),
            "prompt_version": meta.get("prompt_version"),
            "generated_at": meta.get("generated_at"),
            "goal_mode": meta.get("goal_mode"),
        },
    }


def preview_for_execution(runtime: Path) -> Optional[Dict[str, Any]]:
    """Small object for enrich_execution (no full markdown)."""
    rdir = refined_runtime_dir(runtime)
    latest = rdir / "latest.json"
    if not latest.exists():
        return None
    try:
        data = json.loads(latest.read_text(encoding="utf-8"))
    except Exception:
        return None
    rid = data.get("refined_id")
    if not rid:
        return None
    meta_path = rdir / f"{rid}.meta.json"
    if not meta_path.exists():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return {
        "refined_id": rid,
        "generated_at": meta.get("generated_at"),
        "based_on_generation_id": meta.get("based_on_generation_id"),
        "refinement_focus": meta.get("refinement_focus") or [],
        "polish_notes": meta.get("polish_notes") or "",
        "model_name": meta.get("model_name"),
        "prompt_version": meta.get("prompt_version"),
    }
