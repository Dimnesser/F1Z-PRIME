#!/bin/bash
# Release: Japan region + phone-code stock health. Backend + web.
# Patched copy -> images -> FULL suite on a throwaway DB; deploy only if every failure also fails on the
# unpatched baseline ($BASELINE_LOG) -> DB dump -> swap api/bot/worker/web with automatic rollback.
set -euo pipefail
umask 077
cd /
STAMP=${STAMP:-$(date -u +%Y%m%d-%H%M)}
PATCHES=${PATCHES:-"/opt/f1z-deploy/japan/patch /opt/f1z-deploy/stock-health/patch"}
BASELINE_LOG=${BASELINE_LOG:?baseline tests.log required}
ROOT=/opt/f1z-deploy/release-$STAMP
BACKUP=/opt/f1z-backups/$STAMP-release-preupdate
TAG=release-$STAMP
SITE=https://vps4.vps.webdock.cloud

mkdir -p "$ROOT" "$BACKUP"
rsync -a --exclude node_modules --exclude dist --exclude sessions --exclude backups --exclude /.env /opt/f1z-prime/ "$ROOT/release/"
rm -f "$ROOT/release/.env"
for p in $PATCHES; do python3 "$p/apply_patch.py" "$ROOT/release" --check; done
for p in $PATCHES; do python3 "$p/apply_patch.py" "$ROOT/release"; done
find "$ROOT/release" -type d -exec chmod 755 {} + -o -type f -exec chmod 644 {} +
CHANGED=$(cd "$ROOT/release" && for f in $(find backend frontend admin tests -type f \( -name '*.py' -o -name '*.tsx' -o -name '*.ts' \) -not -path '*/node_modules/*'); do cmp -s "$f" "/opt/f1z-prime/$f" || echo "$f"; done)
echo "CHANGED_FILES:"; echo "$CHANGED"

docker image inspect "f1z-prime-backend:$TAG" > /dev/null 2>&1 ||
  docker build -t "f1z-prime-backend:$TAG" -f "$ROOT/release/backend/Dockerfile" "$ROOT/release" > "$ROOT/backend-build.log" 2>&1 || { tail -40 "$ROOT/backend-build.log"; exit 1; }
docker image inspect "f1z-prime-web:$TAG" > /dev/null 2>&1 ||
  docker build -t "f1z-prime-web:$TAG" -f "$ROOT/release/docker/web.Dockerfile" "$ROOT/release" > "$ROOT/web-build.log" 2>&1 || { tail -60 "$ROOT/web-build.log"; exit 1; }

DB=f1z_deploy_test_release
NET=$(docker inspect f1z-prime-api-1 --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}')
docker exec f1z-prime-db-1 sh -c 'dropdb --if-exists -U "$POSTGRES_USER" "$1" && createdb -U "$POSTGRES_USER" "$1"' sh "$DB"
trap 'docker exec f1z-prime-db-1 sh -c "dropdb --if-exists -U \"\$POSTGRES_USER\" \"\$1\"" sh "$DB" || true' EXIT
DBURL=$(docker exec f1z-prime-db-1 sh -c 'printf "postgresql+asyncpg://%s:%s@db:5432/" "$POSTGRES_USER" "$POSTGRES_PASSWORD"')$DB
set +e
TEST_DATABASE_URL=$DBURL docker run --rm --memory 512m --cpus 1 --network "$NET" -e TEST_DATABASE_URL \
  -e PYTHONPATH=/tmp/testdeps:/srv:/test --mount "type=bind,src=$ROOT/release,dst=/test,readonly" --entrypoint sh \
  "f1z-prime-backend:$TAG" -c 'pip install --quiet --target /tmp/testdeps pytest==8.3.4 pytest-asyncio==0.24.0 && cd /test && python -m pytest -q -p no:cacheprovider tests' \
  > "$ROOT/tests.log" 2>&1
set -e
tail -1 "$ROOT/tests.log"
grep -E '^(FAILED|ERROR) tests/' "$ROOT/tests.log" | sed -E 's/ - .*//' | sort -u > "$ROOT/failed.txt" || true
grep -E '^(FAILED|ERROR) tests/' "$BASELINE_LOG" | sed -E 's/ - .*//' | sort -u > "$ROOT/baseline-failed.txt" || true
NEW=$(comm -23 "$ROOT/failed.txt" "$ROOT/baseline-failed.txt")
FIXED=$(comm -13 "$ROOT/failed.txt" "$ROOT/baseline-failed.txt")
echo "FAILED: $(wc -l < "$ROOT/failed.txt") (baseline $(wc -l < "$ROOT/baseline-failed.txt"))"
[ -n "$FIXED" ] && { echo "NO_LONGER_FAILING:"; echo "$FIXED"; }
grep -qE 'passed' "$ROOT/tests.log" || { echo "TESTS_DID_NOT_RUN"; tail -30 "$ROOT/tests.log"; exit 1; }
[ -z "$NEW" ] || { echo "NEW_FAILURES (not deployed):"; echo "$NEW"; exit 1; }
[ "${TEST_ONLY:-0}" = 1 ] && { echo "RELEASE_TESTS_OK $TAG (test only)"; exit 0; }

docker exec f1z-prime-db-1 sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP/database.dump"
docker tag "$(docker inspect f1z-prime-api-1 --format '{{.Image}}')" "f1z-prime-backend:rollback-$TAG"
docker tag "$(docker inspect f1z-prime-web-1 --format '{{.Image}}')" "f1z-prime-web:rollback-$TAG"
for f in $CHANGED; do mkdir -p "$BACKUP/files/$(dirname "$f")"; [ -f "/opt/f1z-prime/$f" ] && cp -a "/opt/f1z-prime/$f" "$BACKUP/files/$f"; done
echo "$CHANGED" > "$BACKUP/changed-files.txt"
for f in $CHANGED; do install -D -m 644 "$ROOT/release/$f" "/opt/f1z-prime/$f"; done
cat > "$ROOT/images.yml" <<IMAGES
services:
  api: {image: "f1z-prime-backend:$TAG"}
  bot: {image: "f1z-prime-backend:$TAG"}
  worker: {image: "f1z-prime-backend:$TAG"}
  web: {image: "f1z-prime-web:$TAG"}
IMAGES
sed "s/:$TAG\"/:rollback-$TAG\"/g" "$ROOT/images.yml" > "$BACKUP/rollback-images.yml"
cd /opt/f1z-prime
COMPOSE=(docker compose -p f1z-prime -f docker-compose.yml)
[ -f docker-compose.override.yml ] && COMPOSE+=(-f docker-compose.override.yml)
rollback() {
  for f in $CHANGED; do if [ -f "$BACKUP/files/$f" ]; then cp -a "$BACKUP/files/$f" "/opt/f1z-prime/$f"; else rm -f "/opt/f1z-prime/$f"; fi; done
  "${COMPOSE[@]}" -f "$BACKUP/rollback-images.yml" up -d --no-build --no-deps --wait --wait-timeout 150 api bot worker web
  echo RELEASE_ROLLED_BACK; exit 1
}
"${COMPOSE[@]}" -f "$ROOT/images.yml" up -d --no-build --no-deps --wait --wait-timeout 150 api bot worker web || rollback
for path in /api/health / /admin/; do
  curl --fail --silent --show-error --max-time 20 -o /dev/null -w "$path %{http_code}\n" "$SITE$path" || rollback
done
curl --fail --silent --max-time 20 "$SITE/api/countries" | python3 -c 'import json,sys; c={x["code"]:x for x in json.load(sys.stdin)}; j=c["JP"]; print("JP", j["dial_code"], j["price"], j["stock"], j["product_id"])' || rollback
echo "RELEASE_DEPLOYED $TAG (rollback images: *:rollback-$TAG, backup: $BACKUP)"
