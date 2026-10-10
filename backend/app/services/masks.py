"""Helpers for premium number display masks.

Admins set `display_mask` manually (e.g. ``+1 *** 7777 ***``). ``auto_mask`` builds
a sensible default that keeps the "beautiful" part of the number visible.
"""
from __future__ import annotations

import re

MASK_CHAR = "*"


def digits_only(value: str) -> str:
    return re.sub(r"\D", "", value)


def auto_mask(number: str, dial_code: str = "", visible: str | None = None) -> str:
    """Hide everything except the dial code and the most "beautiful" 4 digits.

    If ``visible`` is given, that substring of the national part is kept open.
    """
    digits = digits_only(number)
    dial = digits_only(dial_code)
    national = digits[len(dial):] if dial and digits.startswith(dial) else digits
    if not national:
        return f"+{dial}" if dial else ""
    keep_start, keep_len = _best_window(national, visible)
    before = MASK_CHAR * keep_start
    visible_part = national[keep_start : keep_start + keep_len]
    after = MASK_CHAR * (len(national) - keep_start - keep_len)
    groups = " ".join(g for g in (before, visible_part, after) if g)
    prefix = f"+{dial} " if dial else "+"
    return (prefix + groups).strip()


def _best_window(national: str, visible: str | None) -> tuple[int, int]:
    if visible:
        v = digits_only(visible)
        idx = national.find(v)
        if v and idx >= 0:
            return idx, len(v)
    size = min(4, len(national))
    best, best_score = len(national) - size, -1
    for i in range(0, len(national) - size + 1):
        chunk = national[i : i + size]
        score = _beauty(chunk)
        if score > best_score:
            best, best_score = i, score
    return best, size


def _beauty(chunk: str) -> int:
    score = 0
    score += (len(chunk) - len(set(chunk))) * 3  # repeated digits
    asc = all(int(b) - int(a) == 1 for a, b in zip(chunk, chunk[1:]))
    desc = all(int(a) - int(b) == 1 for a, b in zip(chunk, chunk[1:]))
    if asc or desc:
        score += 8
    if chunk == chunk[::-1]:
        score += 4
    return score


def validate_mask(mask: str) -> bool:
    """A mask must hide at least 2 digits and contain only safe characters."""
    if not re.fullmatch(r"[+\d*•xX#\s()\-]{4,40}", mask):
        return False
    return sum(mask.count(c) for c in "*•xX#") >= 2
