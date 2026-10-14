#!/bin/bash
# Deploy the Japan (+81) region on vps4. Backend only (api/bot/worker); the web image is unchanged.
# Patched copy -> backend image -> FULL test suite on a throwaway DB -> DB dump -> swap with auto-rollback.
set -euo pipefail
umask 077
cd /
STAMP=${STAMP:-$(date -u +%Y%m%d-%H%M)}
PATCH=${PATCH:-/opt/f1z-deploy/japan/patch}
ROOT=/opt/f1z-deploy/japan-$STAMP
BACKUP=/opt/f1z-backups/$STAMP-japan-preupdate
TAG=japan-$STAMP
SITE=https://vps4.vps.webdock.cloud
FILES="backend/app/seed.py backend/app/services/phones.py backend/app/services/regions.py
       tests/test_api.py tests/test_catalog_2026.py tests/test_region_japan.py"

mkdir -p "$ROOT" "$BACKUP"
rsync -a --exclude node_modules --exclude dist --exclude sessions --exclude backups --exclude /.env /opt/f1z-prime/ "$ROOT/release/"
rm -f "$ROOT/release/.env"
python3 "$PATCH/apply_patch.py" "$ROOT/release" --check
python3 "$PATCH/apply_patch.py" "$ROOT/release"
find "$ROOT/release" -type d -exec chmod 755 {} + -o -type f -exec chmod 644 {} +

docker image inspect "f1z-prime-backend:$TAG" > /dev/null 2>&1 ||
  docker build -t "f1z-prime-backend:$TAG" -f "$ROOT/release/backend/Dockerfile" "$ROOT/release" > "$ROOT/backend-build.log" 2>&1 || { tail -40 "$ROOT/backend-build.log"; exit 1; }

DB=f1z_deploy_test_japan_${STAMP//-/_}
NET=$(docker inspect f1z-prime-api-1 --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}')
docker exec f1z-prime-db-1 sh -c 'dropdb --if-exists -U "$POSTGRES_USER" "$1" && createdb -U "$POSTGRES_USER" "$1"' sh "$DB"
trap 'docker exec f1z-prime-db-1 sh -c "exec dropdb --if-exists -U \"\$POSTGRES_USER\" \"\$1\"" sh "$DB" || true' EXIT
DBURL=$(docker exec f1z-prime-db-1 sh -c 'printf "postgresql+asyncpg://%s:%s@db:5432/" "$POSTGRES_USER" "$POSTGRES_PASSWORD"')$DB
TEST_DATABASE_URL=$DBURL docker run --rm --memory 512m --cpus 1 --network "$NET" -e TEST_DATABASE_URL \
  -e PYTHONPATH=/tmp/testdeps:/srv:/test --mount "type=bind,src=$ROOT/release,dst=/test,readonly" --entrypoint sh \
  "f1z-prime-backend:$TAG" -c 'pip install --quiet --target /tmp/testdeps pytest==8.3.4 pytest-asyncio==0.24.0 && cd /test && python -m pytest -q -p no:cacheprovider tests' \
  > "$ROOT/tests.log" 2>&1 || { grep -E '^(FAILED|ERROR)' "$ROOT/tests.log" | head -40; tail -5 "$ROOT/tests.log"; exit 1; }
tail -3 "$ROOT/tests.log"
[ "${TEST_ONLY:-0}" = 1 ] && { echo "JAPAN_TESTS_OK $TAG (test only, production untouched)"; exit 0; }

docker exec f1z-prime-db-1 sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP/database.dump"
docker tag "$(docker inspect f1z-prime-api-1 --format '{{.Image}}')" "f1z-prime-backend:rollback-$TAG"
for f in $FILES; do mkdir -p "$BACKUP/files/$(dirname "$f")"; [ -f "/opt/f1z-prime/$f" ] && cp -a "/opt/f1z-prime/$f" "$BACKUP/files/$f"; done
for f in $FILES; do install -m 644 "$ROOT/release/$f" "/opt/f1z-prime/$f"; done
printf 'services:\n  api: {image: "f1z-prime-backend:%s"}\n  bot: {image: "f1z-prime-backend:%s"}\n  worker: {image: "f1z-prime-backend:%s"}\n' "$TAG" "$TAG" "$TAG" > "$ROOT/images.yml"
sed "s/:$TAG\"/:rollback-$TAG\"/g" "$ROOT/images.yml" > "$BACKUP/rollback-images.yml"
cd /opt/f1z-prime
COMPOSE=(docker compose -p f1z-prime -f docker-compose.yml)
[ -f docker-compose.override.yml ] && COMPOSE+=(-f docker-compose.override.yml)
rollback() {
  for f in $FILES; do if [ -f "$BACKUP/files/$f" ]; then cp -a "$BACKUP/files/$f" "/opt/f1z-prime/$f"; else rm -f "/opt/f1z-prime/$f"; fi; done
  "${COMPOSE[@]}" -f "$BACKUP/rollback-images.yml" up -d --no-build --no-deps --wait --wait-timeout 150 api bot worker
  echo JAPAN_ROLLED_BACK; exit 1
}
"${COMPOSE[@]}" -f "$ROOT/images.yml" up -d --no-build --no-deps --wait --wait-timeout 150 api bot worker || rollback
for path in /api/health / /admin/; do
  curl --fail --silent --show-error --max-time 20 -o /dev/null -w "$path %{http_code}\n" "$SITE$path" || rollback
done
curl --fail --silent --max-time 20 "$SITE/api/countries" | python3 -c 'import json,sys; c={x["code"]:x for x in json.load(sys.stdin)}; j=c["JP"]; print("JP", j["dial_code"], j["price"], j["stock"], j["product_id"])' || rollback
docker exec f1z-prime-db-1 psql -U f1z -d f1z -Atc "select p.id,p.title,p.status,p.fulfillment_mode,p.uses_phone_inventory,p.attributes from products p join countries c on c.id=p.country_id where c.code='JP'"
echo "JAPAN_DEPLOYED $TAG (rollback image: f1z-prime-backend:rollback-$TAG, backup: $BACKUP)"
