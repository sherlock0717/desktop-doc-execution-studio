"""Rule-based submission readiness for the middle column."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


def build_upload_snapshot(upload_root: Path, document_names: List[str]) -> Dict[str, Any]:
    rows: List[Dict[str, Any]] = []
    for name in sorted(document_names):
        p = upload_root / name
        if not p.is_file():
            rows.append({"name": name, "size": -1, "mtime_iso": ""})
            continue
        st = p.stat()
        rows.append(
            {
                "name": name,
                "size": st.st_size,
                "mtime_iso": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
        )
    return {
        "captured_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "files": rows,
    }


def _snap_key(snap: Optional[Dict[str, Any]]) -> Optional[str]:
    if not snap or not isinstance(snap, dict):
        return None
    files = snap.get("files") or []
    parts = []
    for f in sorted(files, key=lambda x: x.get("name", "")):
        parts.append(f"{f.get('name')}|{f.get('size')}|{f.get('mtime_iso')}")
    return "\n".join(parts)


def inputs_changed_since_generation(stored: Optional[Dict[str, Any]], current: Dict[str, Any]) -> bool:
    if not stored or not stored.get("files"):
        return False
    return _snap_key(stored) != _snap_key(current)


def build_readiness_summary(
    *,
    documents: List[Dict[str, Any]],
    missing_inputs: List[str],
    acceptance_hints: Optional[Dict[str, Any]],
    execution: Dict[str, Any],
    upload_root: Path,
    has_generated: bool,
) -> Dict[str, Any]:
    hints = acceptance_hints or {}
    unconfirmed = int(hints.get("unconfirmed_type_count") or 0)
    items = execution.get("suggestion_items") or []
    pending_apply = [s for s in items if s.get("status") == "accepted" and not s.get("applied_to_draft")]

    snap_stored = execution.get("input_snapshot_at_generation")
    names = [d.get("name") for d in documents if d.get("name")]
    snap_now = build_upload_snapshot(upload_root, names)
    stale = bool(has_generated and inputs_changed_since_generation(snap_stored, snap_now))

    missing_key = len(missing_inputs or []) > 0
    unconfirmed_files = unconfirmed > 0
    pending_apply_flag = len(pending_apply) > 0

    issues: List[Dict[str, str]] = []
    if missing_key:
        issues.append({"code": "missing_inputs", "severity": "warn", "message": "按当前目标模式仍缺少关键材料输入。"})
    if unconfirmed_files:
        issues.append({"code": "unconfirmed_types", "severity": "warn", "message": f"还有 {unconfirmed} 个文件类型未确认。"})
    if pending_apply_flag:
        issues.append(
            {
                "code": "pending_apply",
                "severity": "info",
                "message": f"有 {len(pending_apply)} 条建议已接受但尚未写入工作稿。",
            }
        )
    if stale:
        issues.append(
            {
                "code": "inputs_changed",
                "severity": "warn",
                "message": "自上次解析后，导入材料文件已发生变化，建议重新解析以对齐最新材料。",
            }
        )

    summary_lines: List[str] = []
    if not has_generated:
        summary_lines.append("尚未解析：准备度会在首次解析后结合建议和工作稿评估。")
    else:
        summary_lines.append("关键输入：" + ("未齐" if missing_key else "已按规则满足") + "。")
        summary_lines.append("类型确认：" + ("未完成" if unconfirmed_files else "无未确认项") + "。")
        summary_lines.append(
            "建议写入："
            + (f"{len(pending_apply)} 条已接受但未写入" if pending_apply_flag else "无已接受但未写入")
            + "。"
        )
        summary_lines.append("材料同步：" + ("自上次解析后有变更" if stale else "与上次解析快照一致") + "。")

    blocking = missing_key or unconfirmed_files or stale

    return {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "has_generated": has_generated,
        "checks": {
            "missing_key_inputs": missing_key,
            "unconfirmed_file_types": unconfirmed_files,
            "accepted_not_applied": pending_apply_flag,
            "inputs_changed_since_last_generation": stale,
        },
        "counts": {
            "unconfirmed_files": unconfirmed,
            "accepted_pending_apply": len(pending_apply),
        },
        "pending_apply_ids": [x.get("id") for x in pending_apply if x.get("id")],
        "issues": issues,
        "summary_lines": summary_lines,
        "overall_ready": bool(has_generated and not blocking and not pending_apply_flag),
    }
