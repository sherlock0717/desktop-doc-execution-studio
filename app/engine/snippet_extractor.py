"""Deterministic snippet candidates for evidence chains (snippet_id bound to source text)."""

from __future__ import annotations

import re
from typing import Dict, List, TypedDict


class SnippetRecord(TypedDict):
    snippet_id: str
    source_file: str
    snippet_text: str


def _chunk_long_text(text: str, max_len: int) -> List[str]:
    """Split oversized paragraphs by sentence-ish boundaries."""
    parts: List[str] = []
    buf = text
    while buf:
        if len(buf) <= max_len:
            parts.append(buf)
            break
        cut = buf[:max_len]
        break_at = max(cut.rfind("。"), cut.rfind("！"), cut.rfind("？"), cut.rfind(". "), cut.rfind("\n"))
        if break_at < max_len // 4:
            break_at = max_len
        chunk = buf[: break_at + 1].strip()
        if not chunk:
            chunk = buf[:max_len]
        parts.append(chunk)
        buf = buf[len(chunk) :].strip()
    return parts


def split_into_snippets(
    text: str,
    *,
    max_snippets: int = 18,
    max_len: int = 240,
) -> List[str]:
    t = (text or "").strip()
    if not t:
        return []

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n+", t) if p.strip()]
    if len(paragraphs) <= 1 and "\n" in t:
        paragraphs = [line.strip() for line in t.splitlines() if line.strip()]

    out: List[str] = []
    for p in paragraphs:
        if len(p) <= max_len:
            out.append(p)
        else:
            out.extend(_chunk_long_text(p, max_len))
        if len(out) >= max_snippets:
            break

    return out[:max_snippets]


def build_snippet_catalog(
    documents: List[Dict],
    text_map: Dict[str, str],
) -> List[SnippetRecord]:
    """
    Stable ordering: sort by filename; assign s0001, s0002, ...
    """
    snippets: List[SnippetRecord] = []
    counter = 0
    for doc in sorted(documents, key=lambda d: d["name"].lower()):
        name = doc["name"]
        raw = text_map.get(name, "") or ""
        for piece in split_into_snippets(raw):
            counter += 1
            sid = f"s{counter:04d}"
            snippets.append(
                {
                    "snippet_id": sid,
                    "source_file": name,
                    "snippet_text": piece,
                }
            )
    return snippets


def catalog_to_map(catalog: List[SnippetRecord]) -> Dict[str, SnippetRecord]:
    return {item["snippet_id"]: item for item in catalog}
