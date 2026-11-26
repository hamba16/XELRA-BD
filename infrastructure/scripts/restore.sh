#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${RESTORE_DATABASE_URL:?}" "${RESTORE_ACK:?}" "${AGE_SECRET_KEY:?}"
: "${R2_BACKUP_BUCKET:?}"
test "$RESTORE_ACK" = 'DISPOSABLE_LOCAL_DATABASE_ONLY'
# The destructive restore target must be loopback. Production cannot be an input.
python - <<'PY'
import os, urllib.parse
u = urllib.parse.urlparse(os.environ['RESTORE_DATABASE_URL'])
assert u.scheme in ('postgres', 'postgresql') and u.hostname in ('127.0.0.1', 'localhost'), 'Local restore only'
assert not u.query, 'No connection query parameters allowed'
PY
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
name=$(rclone lsf "r2:$R2_BACKUP_BUCKET/db" --files-only --include '*.dump.age' | sort | tail -1)
[[ "$name" =~ ^xelra-[0-9TZ]+-[a-zA-Z0-9_-]+\.dump\.age$ ]]
rclone copyto "r2:$R2_BACKUP_BUCKET/db/$name" "$work/$name"
rclone copyto "r2:$R2_BACKUP_BUCKET/db/$name.sha256" "$work/$name.sha256"
python - "$work" "$name" <<'PY'
import hashlib, pathlib, sys
folder, name = pathlib.Path(sys.argv[1]), sys.argv[2]
expected, filename = (folder / (name + '.sha256')).read_text().strip().split()
assert filename == name, 'Unexpected checksum target'
assert hashlib.file_digest((folder / name).open('rb'), 'sha256').hexdigest() == expected, 'Checksum mismatch'
PY
printf '%s\n' "$AGE_SECRET_KEY" > "$work/identity"
age -d -i "$work/identity" -o "$work/database.dump" "$work/$name"
pg_restore --list "$work/database.dump" > "$work/toc"
# Never execute scheduled jobs or outbound network extensions in a restore drill.
# Provision a disposable matching Supabase stack, with cron.launch_active_jobs=off.
pg_restore --exit-on-error --no-owner --clean --if-exists \
  --dbname="$RESTORE_DATABASE_URL" "$work/database.dump"
TEST_DATABASE_URL="$RESTORE_DATABASE_URL" python tests/run-database.py
node infrastructure/scripts/ops.mjs heartbeat restore_drill
echo "Restored and tested encrypted backup: $name" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
