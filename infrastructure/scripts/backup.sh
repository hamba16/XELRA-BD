#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${BACKUP_DATABASE_URL:?}" "${AGE_PUBLIC_KEYS:?}" "${R2_BACKUP_BUCKET:?}"
: "${RCLONE_CONFIG_R2_ENDPOINT:?}"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="xelra-${stamp}-${GITHUB_RUN_ID:-local}.dump.age"
# pg_dump's custom archive uses one consistent database snapshot, retaining ACLs.
# Client must be the same or a newer major than the database server.
pg_dump --dbname="$BACKUP_DATABASE_URL" --format=custom --no-owner \
  --exclude-table-data=net.http_request_queue --exclude-table-data=net._http_response \
  --file="$work/database.dump"
pg_restore --list "$work/database.dump" > "$work/toc"
grep -q 'ops_heartbeats' "$work/toc"
printf '%s\n' "$AGE_PUBLIC_KEYS" | tr ',' '\n' > "$work/recipients"
test "$(grep -c '^age1' "$work/recipients")" -ge 2
test "$(wc -c < "$work/database.dump")" -gt 20000
age -R "$work/recipients" -o "$work/$name" "$work/database.dump"
(cd "$work" && sha256sum "$name" > "$name.sha256")
rclone copyto "$work/$name" "r2:$R2_BACKUP_BUCKET/db/$name"
rclone copyto "$work/$name.sha256" "r2:$R2_BACKUP_BUCKET/db/$name.sha256"
# Download the ciphertext and verify it, not just a successful upload response.
mkdir "$work/readback"
rclone copyto "r2:$R2_BACKUP_BUCKET/db/$name" "$work/readback/$name"
cp "$work/$name.sha256" "$work/readback/"
(cd "$work/readback" && sha256sum --check "$name.sha256")
# Retain one snapshot per week/month. Every tier is read back before success.
prefixes=()
if test "$(date -u +%u)" = 7; then prefixes+=(weekly); fi
if test "$(date -u +%d)" = 01; then prefixes+=(monthly); fi
for prefix in "${prefixes[@]}"; do
  rclone copyto "$work/$name" "r2:$R2_BACKUP_BUCKET/$prefix/$name"
  rclone copyto "$work/$name.sha256" "r2:$R2_BACKUP_BUCKET/$prefix/$name.sha256"
  rclone copyto "r2:$R2_BACKUP_BUCKET/$prefix/$name" "$work/readback/$name"
  (cd "$work/readback" && sha256sum --check "$name.sha256")
done
node infrastructure/scripts/ops.mjs heartbeat backup
echo "Verified encrypted backup: $name" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
# No delete credentials or automatic purge. Retention is applied by bucket lifecycle.
