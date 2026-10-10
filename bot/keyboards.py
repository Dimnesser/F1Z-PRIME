from __future__ import annotations

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

from app.config import get_settings


def webapp_url(path: str = "") -> str | None:
    """Telegram accepts only HTTPS Mini App URLs. Returns None for local http URLs."""
    base = get_settings().webapp_url.rstrip("/")
    if not base.startswith("https://"):
        return None
    return f"{base}/{path.lstrip('/')}" if path else base


def webapp_button(text: str, path: str = "") -> InlineKeyboardButton | None:
    url = webapp_url(path)
    return InlineKeyboardButton(text=text, web_app=WebAppInfo(url=url)) if url else None


def _rows(*rows: list[InlineKeyboardButton | None]) -> InlineKeyboardMarkup:
    clean = [[b for b in row if b is not None] for row in rows]
    return InlineKeyboardMarkup(inline_keyboard=[r for r in clean if r])


def main_menu() -> InlineKeyboardMarkup:
    return _rows(
        [webapp_button("🚀 Открыть магазин")],
        [
            InlineKeyboardButton(text="🛍 Каталог", callback_data="catalog"),
            InlineKeyboardButton(text="💎 Красивые номера", callback_data="premium"),
        ],
        [
            InlineKeyboardButton(text="👤 Профиль", callback_data="profile"),
            InlineKeyboardButton(text="📦 Мои покупки", callback_data="orders"),
        ],
        [InlineKeyboardButton(text="🆘 Поддержка", callback_data="support")],
    )


def back(to: str = "menu", text: str = "⬅️ Назад") -> list[InlineKeyboardButton]:
    return [InlineKeyboardButton(text=text, callback_data=to)]


def menu_row() -> list[InlineKeyboardButton]:
    return [InlineKeyboardButton(text="🏠 Главное меню", callback_data="menu")]


def rows(*r: list[InlineKeyboardButton | None]) -> InlineKeyboardMarkup:
    return _rows(*r)
