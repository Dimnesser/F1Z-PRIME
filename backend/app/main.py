from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api import admin, admin_reports, admin_system, public
from app.config import get_settings
from app.db import dispose_engine, session_factory
from app.services import backup, monitor
from app.services import settings as settings_service
from app.services import telegram
from app.services.common import ServiceError
from app.services.orders import expire_stale_orders

log = logging.getLogger("f1z")


def setup_logging() -> None:
    logging.basicConfig(
        level=get_settings().log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    # httpx logs full request URLs at INFO — Bot API URLs contain the bot token.
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


async def _expiry_loop() -> None:
    while True:
        try:
            async with session_factory()() as session:
                if await settings_service.get_bool(session, "expire_reservations"):
                    n = await expire_stale_orders(session)
                    await session.commit()
                    if n:
                        log.info("expired %s unpaid orders", n)
        except Exception:  # noqa: BLE001
            log.exception("expiry loop failed")
        await asyncio.sleep(60)


async def _automation_loop() -> None:
    """Retries undelivered notifications, low-stock alerts and the daily backup (each one switchable)."""
    alerted: set[int] = set()
    tick = 0
    while True:
        try:
            async with session_factory()() as session:
                retry = await settings_service.get_bool(session, "notification_retry")
                low_stock = await settings_service.get_bool(session, "low_stock_alerts")
                auto_backup = await settings_service.get_bool(session, "auto_backup")
                threshold = int(await settings_service.get_value(session, "low_stock_threshold") or 5)
            if retry:
                await telegram.retry_outbox()
            if low_stock and tick % 10 == 0:
                await _low_stock_alerts(alerted, threshold)
            if auto_backup and tick % 30 == 0:
                age = backup.last_backup_age_hours()
                if age is None or age >= 24:
                    await backup.create_backup()
        except Exception:  # noqa: BLE001
            log.exception("automation loop failed")
        tick += 1
        await asyncio.sleep(60)


async def _low_stock_alerts(alerted: set[int], threshold: int) -> None:
    from sqlalchemy import select

    from app.models import Product, ProductStatus

    async with session_factory()() as session:
        rows = (
            await session.scalars(select(Product).where(Product.status == ProductStatus.active))
        ).unique().all()
    low = {p.id: p for p in rows if p.stock <= threshold}
    alerted.intersection_update(low)  # restocked products can alert again later
    fresh = [p for pid, p in low.items() if pid not in alerted]
    if fresh:
        lines = "\n".join(f"• {p.title}: {p.stock} шт." for p in fresh[:20])
        await telegram.notify_admins(f"📉 Низкий остаток (≤ {threshold}):\n{lines}")
        alerted.update(p.id for p in fresh)


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    setup_logging()
    s = get_settings()
    log.info("F1Z PRIME API starting (env=%s, dev_mode=%s)", s.environment, s.dev_mode)
    tasks = [asyncio.create_task(_expiry_loop()), asyncio.create_task(_automation_loop())] if s.run_background_tasks else []
    yield
    for task in tasks:
        task.cancel()
    await dispose_engine()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title="F1Z PRIME API",
        version="1.0.0",
        lifespan=lifespan,
        docs_url=None if s.is_production else "/api/docs",
        openapi_url=None if s.is_production else "/api/openapi.json",
        redoc_url=None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_list,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.exception_handler(ServiceError)
    async def _service_error(_: Request, exc: ServiceError) -> JSONResponse:
        return JSONResponse({"detail": exc.message, "code": exc.code}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        first = errors[0] if errors else {}
        field = ".".join(str(x) for x in first.get("loc", [])[1:])
        return JSONResponse(
            {"detail": f"Некорректные данные: {field} — {first.get('msg', '')}".strip(), "errors": jsonable(errors)},
            status_code=422,
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error on %s %s", request.method, request.url.path)
        await monitor.record("server", f"{type(exc).__name__}: {exc}"[:300], f"{request.method} {request.url.path}")
        return JSONResponse({"detail": "Внутренняя ошибка сервера"}, status_code=500)

    @app.get("/api/health", tags=["system"])
    async def health() -> dict:
        async with session_factory()() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ok"}

    app.include_router(public.router)
    app.include_router(admin.router)
    app.include_router(admin_reports.router)
    app.include_router(admin_system.router)
    return app


def jsonable(errors: list) -> list:
    return [{"loc": e.get("loc"), "msg": e.get("msg"), "type": e.get("type")} for e in errors]


app = create_app()
