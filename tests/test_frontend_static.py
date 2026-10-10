"""Static guards for frontend pitfalls that only show up on specific Telegram WebViews."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Effects whose expression body intentionally returns a cleanup function.
ALLOWED = {"frontend/src/lib/useBack.ts"}


def test_effects_do_not_return_expression_values():
    """`useEffect(() => expr)` hands expr's value to React as the cleanup.

    In Chrome 153+ (Telegram Android) scrollTo/scrollIntoView return a Promise, which made
    React throw "i is not a function" on the next tab switch. Effects must use a block body.
    """
    pattern = re.compile(r"use(?:Layout)?Effect\(\(\)\s*=>\s*[^{\s]")
    offenders = []
    for path in list((ROOT / "frontend/src").rglob("*.ts*")) + list((ROOT / "admin/src").rglob("*.ts*")):
        rel = path.relative_to(ROOT).as_posix()
        if rel in ALLOWED:
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if pattern.search(line):
                offenders.append(f"{rel}:{n}: {line.strip()}")
    assert not offenders, "useEffect with expression body:\n" + "\n".join(offenders)
