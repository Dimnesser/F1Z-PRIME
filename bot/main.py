"""F1Z PRIME Telegram bot (aiogram 3, long polling). Shares the database with the API."""
from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand, MenuButtonWebApp, WebAppInfo

from app.config import get_settings
from app.db import dispose_engine, session_factory
from bot.handlers import router
from bot.keyboards import webapp_url

log = logging.getLogger("f1z.bot")


def build_dispatcher() -> Dispatcher:
    dp = Dispatcher()
    dp.include_router(router)
    return dp


async def setup_bot(bot: Bot) -> None:
    await bot.set_my_commands(
        [
            BotCommand(command="start", description="🚀 Главное меню"),
            BotCommand(command="shop", description="🛍 Магазин"),
            BotCommand(command="catalog", description="🛍 Каталог"),
            BotCommand(command="premium", description="💎 Красивые номера"),
            BotCommand(command="profile", description="👤 Профиль"),
            BotCommand(command="balance", description="💳 Баланс"),
            BotCommand(command="orders", description="📦 Мои покупки"),
            BotCommand(command="sms", description="📱 Купить номер"),
            BotCommand(command="support", description="🆘 Поддержка"),
        ]
    )
    url = webapp_url()
    if url:
        await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="F1Z PRIME", web_app=WebAppInfo(url=url)))
    else:
        log.warning("WEBAPP_URL is not https — Mini App buttons are hidden (Telegram requires HTTPS)")


async def heartbeat_loop() -> None:
    """Marks the bot as alive for the admin «Система» page (TaskRun "bot")."""
    from app.models import TaskRun
    from app.services.common import utcnow

    while True:
        try:
            async with session_factory()() as session:
                row = await session.get(TaskRun, "bot")
                if row is None:
                    session.add(TaskRun(name="bot", runs=1, failures=0, last_started_at=utcnow(), last_success_at=utcnow()))
                else:
                    row.runs += 1
                    row.last_success_at = utcnow()
                await session.commit()
        except Exception:  # noqa: BLE001
            log.warning("bot heartbeat failed", exc_info=True)
        await asyncio.sleep(60)


async def main() -> None:
    s = get_settings()
    logging.basicConfig(level=s.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    # httpx logs full request URLs at INFO — Bot API URLs contain the bot token.
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    if not s.bot_token:
        raise SystemExit("BOT_TOKEN is not set")
    bot = Bot(s.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = build_dispatcher()
    try:
        await setup_bot(bot)
        me = await bot.get_me()
        log.info("bot @%s started", me.username)
        beat = asyncio.create_task(heartbeat_loop())  # noqa: F841 - lives as long as polling
        await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
    finally:
        await bot.session.close()
        await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
