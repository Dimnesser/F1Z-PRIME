#!/bin/bash
# Deploy the login-code delivery fix on vps4. Run as root after copying this directory to
# $PATCH (apply_patch.py, test_session_code_delivery.py). Same flow as earlier releases:
# patched copy -> isolated tests -> image build -> swap with automatic rollback.
set -euo pipefail
umask 077
STAMP=${STAMP:-$(date -u +%Y%m%d-%H%M)}
PATCH=${PATCH:-/opt/f1z-deploy/code-delivery/patch}
ROOT=/opt/f1z-deploy/code-delivery-$STAMP
BACKUP=/opt/f1z-backups/$STAMP-code-delivery-preupdate
TAG=code-delivery-$STAMP
SITE=https://vps4.vps.webdock.cloud

mkdir -p "$ROOT" "$BACKUP"
# 1. Patched copy of the live tree (no .env changes, sessions untouched)
rsync -a --exclude node_modules --exclude dist --exclude sessions --exclude backups /opt/f1z-prime/ "$ROOT/release/"
python3 "$PATCH/apply_patch.py" "$ROOT/release" --check
python3 "$PATCH/apply_patch.py" "$ROOT/release"

# 2. Build images (backend first; web build runs tsc and fails on any type error)
docker build -t "f1z-prime-backend:$TAG" -f "$ROOT/release/backend/Dockerfile" "$ROOT/release" > "$ROOT/backend-build.log" 2>&1 || { tail -40 "$ROOT/backend-build.log"; exit 1; }
docker build -t "f1z-prime-web:$TAG" -f "$ROOT/release/docker/web.Dockerfile" "$ROOT/release" > "$ROOT/web-build.log" 2>&1 || { tail -60 "$ROOT/web-build.log"; exit 1; }

# 3. Wizard tests against a throwaway database (dropped afterwards)
DB=f1z_deploy_test_code_delivery_${STAMP//-/_}
NET=$(docker inspect f1z-prime-api-1 --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}')
docker exec f1z-prime-db-1 sh -c 'exec createdb -U "$POSTGRES_USER" "$1"' sh "$DB"
trap 'docker exec f1z-prime-db-1 sh -c "exec dropdb -U \"\$POSTGRES_USER\" \"\$1\"" sh "$DB" || true' EXIT
DBURL=$(docker exec f1z-prime-db-1 sh -c 'printf "postgresql+asyncpg://%s:%s@db:5432/" "$POSTGRES_USER" "$POSTGRES_PASSWORD"')$DB
TEST_DATABASE_URL=$DBURL docker run --rm --memory 384m --cpus 1 --network "$NET" -e TEST_DATABASE_URL \
  -e PYTHONPATH=/tmp/testdeps:/srv:/test --mount "type=bind,src=$ROOT/release,dst=/test,readonly" --entrypoint sh \
  "f1z-prime-backend:$TAG" -c 'pip install --quiet --target /tmp/testdeps pytest==8.3.4 pytest-asyncio==0.24.0 && cd /test && python -m pytest -q -p no:cacheprovider tests/test_session_wizard.py tests/test_session_code_delivery.py' \
  > "$ROOT/tests.log" 2>&1 || { tail -60 "$ROOT/tests.log"; exit 1; }
tail -3 "$ROOT/tests.log"

# 4. Backup and swap
docker exec f1z-prime-db-1 sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP/database.dump"
for svc in api bot worker; do docker tag "$(docker inspect f1z-prime-$svc-1 --format '{{.Image}}')" "f1z-prime-backend:rollback-$TAG"; done
docker tag "$(docker inspect f1z-prime-web-1 --format '{{.Image}}')" "f1z-prime-web:rollback-$TAG"
cp -a /opt/f1z-prime/backend/app/services/session_wizard.py /opt/f1z-prime/backend/app/api/admin_sessions.py \
      /opt/f1z-prime/admin/src/components/files/SessionWizard.tsx "$BACKUP/"
for f in backend/app/services/session_wizard.py backend/app/api/admin_sessions.py \
         admin/src/components/files/SessionWizard.tsx tests/test_session_code_delivery.py; do
  install -m 644 "$ROOT/release/$f" "/opt/f1z-prime/$f"
done
cat > "$ROOT/images.yml" <<IMAGES
services:
  api: {image: "f1z-prime-backend:$TAG"}
  bot: {image: "f1z-prime-backend:$TAG"}
  worker: {image: "f1z-prime-backend:$TAG"}
  web: {image: "f1z-prime-web:$TAG"}
IMAGES
sed "s/:$TAG\"/:rollback-$TAG\"/" "$ROOT/images.yml" > "$BACKUP/rollback-images.yml"
cd /opt/f1z-prime
COMPOSE=(docker compose -p f1z-prime -f docker-compose.yml)
[ -f docker-compose.override.yml ] && COMPOSE+=(-f docker-compose.override.yml)
rollback() {
  cp -a "$BACKUP/session_wizard.py" backend/app/services/; cp -a "$BACKUP/admin_sessions.py" backend/app/api/
  cp -a "$BACKUP/SessionWizard.tsx" admin/src/components/files/; rm -f tests/test_session_code_delivery.py
  "${COMPOSE[@]}" -f "$BACKUP/rollback-images.yml" up -d --no-build --no-deps --wait --wait-timeout 150 api bot worker web
  echo CODE_DELIVERY_ROLLED_BACK; exit 1
}
"${COMPOSE[@]}" -f "$ROOT/images.yml" up -d --no-build --no-deps --wait --wait-timeout 150 api bot worker web || rollback
for path in /api/health /admin/ /admin/files; do
  curl --fail --silent --show-error --max-time 20 -o /dev/null -w "$path %{http_code}\n" "$SITE$path" || rollback
done
code=$(curl --silent -o /dev/null -w '%{http_code}' -X POST "$SITE/api/admin/telegram-sessions/x/resend")
[ "$code" = 401 ] || [ "$code" = 403 ] || rollback
echo "CODE_DELIVERY_DEPLOYED $TAG (rollback images: *:rollback-$TAG, backup: $BACKUP)"
