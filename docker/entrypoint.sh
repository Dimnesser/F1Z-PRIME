#!/bin/sh
set -e
case "$1" in
  api)
    echo "Applying migrations..."
    alembic upgrade head
    if [ "${SEED_ON_START:-true}" = "true" ]; then
      if [ "${SEED_DEMO_PREMIUM:-false}" = "true" ]; then python -m app.seed --demo; else python -m app.seed; fi
    fi
    exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --proxy-headers --forwarded-allow-ips="*" --no-server-header
    ;;
  bot)
    exec python -m bot.main
    ;;
  *)
    exec "$@"
    ;;
esac
