"""Bot tests: real aiogram Dispatcher + routers, Telegram HTTP layer replaced by a recording session."""
from __future__ import annotations

from datetime import datetime
from typing import Any

import pytest
from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.base import BaseSession
from aiogram.methods import AnswerCallbackQuery, EditMessageText, SendMessage, TelegramMethod
from aiogram.types import CallbackQuery, Chat, Message, Update, User

from bot.main import build_dispatcher
from tests.conftest import BOT_TOKEN

CHAT = Chat(id=777, type="private")
FROM = User(id=777, is_bot=False, first_name="Иван", username="ivan")


class RecordingSession(BaseSession):
    def __init__(self) -> None:
        super().__init__()
        self.requests: list[TelegramMethod[Any]] = []

    async def close(self) -> None:
        return None

    async def make_request(self, bot: Bot, method: TelegramMethod[Any], timeout: int | None = None) -> Any:
        self.requests.append(method)
        if isinstance(method, (SendMessage, EditMessageText)):
            return Message(message_id=len(self.requests) + 100, date=datetime.now(), chat=CHAT, text=method.text)
        return True

    async def stream_content(self, *args, **kwargs):  # pragma: no cover
        yield b""


_DP = build_dispatcher()  # routers can be attached to a single dispatcher only


@pytest.fixture
def bot_env():
    session = RecordingSession()
    bot = Bot(BOT_TOKEN, session=session, default=DefaultBotProperties(parse_mode="HTML"))
    return bot, session, _DP


def _msg(text: str, mid: int = 1) -> Update:
    return Update(update_id=mid, message=Message(message_id=mid, date=datetime.now(), chat=CHAT, from_user=FROM, text=text))


def _cb(data: str, uid: int = 10) -> Update:
    msg = Message(message_id=50, date=datetime.now(), chat=CHAT, text="menu")
    return Update(update_id=uid, callback_query=CallbackQuery(id=f"cb{uid}", from_user=FROM, chat_instance="ci", message=msg, data=data))


def _buttons(method) -> list[str]:
    markup = method.reply_markup
    return [b.text for row in markup.inline_keyboard for b in row]


async def test_start_replies_with_menu(bot_env):
    bot, session, dp = bot_env
    await dp.feed_update(bot, _msg("/start"))
    sent = [m for m in session.requests if isinstance(m, SendMessage)]
    assert len(sent) == 1
    assert "Добро пожаловать в F1Z PRIME" in sent[0].text
    buttons = _buttons(sent[0])
    for expected in ["🚀 Открыть магазин", "🛍 Каталог", "💎 Красивые номера", "👤 Профиль", "📦 Мои покупки", "🆘 Поддержка"]:
        assert expected in buttons
    webapp = sent[0].reply_markup.inline_keyboard[0][0]
    assert webapp.web_app is not None and webapp.web_app.url == "https://shop.example.com"


@pytest.mark.parametrize(
    "data,needle",
    [
        ("catalog", "Чили"),
        ("premium", "7777"),
        ("profile", "Telegram ID"),
        ("orders", "нет покупок"),
        ("support", "Поддержка"),
        ("menu", "Добро пожаловать"),
    ],
)
async def test_menu_buttons_work(bot_env, data, needle):
    bot, session, dp = bot_env
    await dp.feed_update(bot, _cb(data))
    edits = [m for m in session.requests if isinstance(m, EditMessageText)]
    assert edits and needle in edits[-1].text
    assert any(isinstance(m, AnswerCallbackQuery) for m in session.requests)


async def test_buy_without_balance_shows_alert(bot_env):
    bot, session, dp = bot_env
    await dp.feed_update(bot, _cb("buy:p:1:balance"))
    alerts = [m for m in session.requests if isinstance(m, AnswerCallbackQuery) and m.show_alert]
    assert alerts and "Недостаточно средств" in alerts[0].text


async def test_buy_with_stars_creates_order(bot_env):
    bot, session, dp = bot_env
    await dp.feed_update(bot, _cb("buy:p:1:stars"))
    edits = [m for m in session.requests if isinstance(m, EditMessageText)]
    assert edits and "Заказ #1" in edits[-1].text
    assert any("Оплатить 71 Stars" in t for t in _buttons(edits[-1]))
    await dp.feed_update(bot, _cb("orders", uid=11))
    edits = [m for m in session.requests if isinstance(m, EditMessageText)]
    assert "#1" in edits[-1].text


async def test_support_ticket_via_bot(bot_env):
    bot, session, dp = bot_env
    await dp.feed_update(bot, _cb("ticket:new"))
    await dp.feed_update(bot, _msg("Не пришёл номер по заказу", mid=2))
    sent = [m for m in session.requests if isinstance(m, SendMessage)]
    assert "Обращение #1 создано" in sent[-1].text
