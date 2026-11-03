# Python image shared by the API and the bot (build context: repository root)
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /srv
COPY backend/requirements.txt /srv/requirements.txt
RUN pip install -r requirements.txt && useradd --create-home --uid 10001 app \
    && mkdir -p /srv/backups /srv/sessions && chown app:app /srv/backups /srv/sessions
COPY backend/app /srv/app
COPY backend/migrations /srv/migrations
COPY backend/alembic.ini /srv/alembic.ini
COPY bot /srv/bot
COPY docker/entrypoint.sh /srv/entrypoint.sh
RUN chmod +x /srv/entrypoint.sh
USER app
ENV PYTHONPATH=/srv
EXPOSE 8000
ENTRYPOINT ["/srv/entrypoint.sh"]
CMD ["api"]
