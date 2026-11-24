#!/usr/bin/env python3
"""Fail the build if an emoji appears anywhere in the product (PRD 1.4, 13.3).

No emojis in the interface, in notifications, in generated documents, in logs or in seed
data. This check runs in CI over source, templates, seed data and interface strings.

    python scripts/check_no_emoji.py
"""

from __future__ import annotations

import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SEARCH_DIRS = [
    ROOT / "backend" / "app",
    ROOT / "backend" / "tests",
    ROOT / "backend" / "alembic",
    ROOT / "frontend" / "src",
    ROOT / "loadtest",
    ROOT / "scripts",
    ROOT / "docs",
    ROOT / "infra",
]

EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".json", ".css", ".html",
    ".md", ".sql", ".yml", ".yaml", ".txt", ".mako", ".toml",
}

SKIP_PARTS = {"node_modules", ".next", "__pycache__", ".git", "var", ".venv", "dist", "build"}

# Codepoint ranges that carry emoji and pictographic characters.
EMOJI_RANGES: tuple[tuple[int, int], ...] = (
    (0x1F000, 0x1FAFF),  # pictographs, emoticons, transport, symbols, extended
    (0x1F1E6, 0x1F1FF),  # regional indicators
    (0x2190, 0x21FF),    # arrows
    (0x2300, 0x23FF),    # technical, including the watch and hourglass
    (0x2460, 0x24FF),    # enclosed alphanumerics
    (0x25A0, 0x27BF),    # geometric shapes, miscellaneous symbols, dingbats
    (0x2B00, 0x2BFF),    # miscellaneous symbols and arrows
    (0xFE0F, 0xFE0F),    # variation selector 16
    (0xE0020, 0xE007F),  # tag characters
)

# Characters inside those ranges that are legitimate typography, not decoration.
ALLOWED = {
    "—",  # em dash
    "–",  # en dash
    "‘", "’", "“", "”",  # curly quotes
    "…",  # ellipsis
    " ",  # non-breaking space
    "−",  # minus sign
}


def is_emoji(char: str) -> bool:
    if char in ALLOWED:
        return False
    point = ord(char)
    if point < 0x2000:
        return False
    for start, end in EMOJI_RANGES:
        if start <= point <= end:
            return True
    return False


def scan(path: Path) -> list[tuple[int, int, str, str]]:
    findings: list[tuple[int, int, str, str]] = []
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return findings
    for line_number, line in enumerate(text.splitlines(), start=1):
        for column, char in enumerate(line, start=1):
            if is_emoji(char):
                try:
                    name = unicodedata.name(char)
                except ValueError:
                    name = "unnamed codepoint"
                findings.append((line_number, column, char, name))
    return findings


def main() -> int:
    failures = 0
    scanned = 0

    for directory in SEARCH_DIRS:
        if not directory.exists():
            continue
        for path in directory.rglob("*"):
            if not path.is_file() or path.suffix not in EXTENSIONS:
                continue
            if any(part in SKIP_PARTS for part in path.parts):
                continue
            scanned += 1
            for line_number, column, char, name in scan(path):
                relative = path.relative_to(ROOT)
                print(
                    str(relative)
                    + ":"
                    + str(line_number)
                    + ":"
                    + str(column)
                    + " contains U+"
                    + format(ord(char), "04X")
                    + " ("
                    + name
                    + ")"
                )
                failures += 1

    if failures:
        print("")
        print("Found " + str(failures) + " emoji or pictographic character(s) in " + str(scanned) + " files.")
        print("PramaanSetu carries none, anywhere: interface, notifications, documents, logs or seed data.")
        return 1

    print("No emoji found in " + str(scanned) + " files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
