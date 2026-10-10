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

from app.api import admin, admin_reports, admin_staff, admin_system, public
from app.config import get_settings
from app.db import dispose_engine, session_factory
from app.services import monitor
from app.services.common import ServiceError

log = logging.getLogger("f1z")


def setup_logging() -> None:
    logging.basicConfig(
        level=get_settings().log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    # httpx logs full request URLs at INFO — Bot API URLs contain the bot token.
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    setup_logging()
    s = get_settings()
    log.info("F1Z PRIME API starting (env=%s, dev_mode=%s)", s.environment, s.dev_mode)
    # Background work (fulfillment, notifications, expiry, backups) runs in the separate worker process
    # (app.worker); with RUN_BACKGROUND_TASKS the API embeds it, for single-process setups.
    task = None
    if s.run_background_tasks:
        from app import worker

        task = asyncio.create_task(worker.main(install_signals=False))
    yield
    if task is not None:
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
    app.include_router(admin_staff.router)
    return app


def jsonable(errors: list) -> list:
    return [{"loc": e.get("loc"), "msg": e.get("msg"), "type": e.get("type")} for e in errors]


app = create_app()
