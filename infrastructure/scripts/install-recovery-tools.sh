#!/usr/bin/env bash
set -euo pipefail
# GitHub Ubuntu 24.04: use the PostgreSQL project's signed package repository.
sudo install -d /usr/share/postgresql-common/pgdg
curl --fail --silent --show-error --max-time 60 --proto '=https' \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /tmp/xelra-pgdg.asc
sudo install -m 0644 /tmp/xelra-pgdg.asc /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
echo 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt noble-pgdg main' | sudo tee /etc/apt/sources.list.d/pgdg.list > /dev/null
sudo apt-get update -q
sudo apt-get install -y postgresql-client-17 age rclone
echo '/usr/lib/postgresql/17/bin' >> "$GITHUB_PATH"
