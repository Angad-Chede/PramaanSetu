"""Money is integer paise everywhere. No floating point arithmetic on currency (PRD 8.3)."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

CURRENCY = "INR"


def rupees_to_paise(value: str | int | float | Decimal) -> int:
    amount = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int(amount * 100)


def paise_to_rupees(paise: int) -> Decimal:
    return (Decimal(paise) / Decimal(100)).quantize(Decimal("0.01"))


def format_inr(paise: int) -> str:
    """Indian digit grouping, for example 12,50,000.00 (PRD 6.4)."""
    negative = paise < 0
    whole, frac = divmod(abs(paise), 100)
    text = str(whole)
    if len(text) > 3:
        head, tail = text[:-3], text[-3:]
        parts: list[str] = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        text = ",".join(parts) + "," + tail
    result = f"{text}.{frac:02d}"
    return f"-{result}" if negative else result


def split_evenly(total_paise: int, parts: int) -> list[int]:
    """Split without losing a single paisa; the remainder goes to the earliest parts."""
    if parts <= 0:
        raise ValueError("parts must be positive")
    base, remainder = divmod(total_paise, parts)
    return [base + (1 if i < remainder else 0) for i in range(parts)]
