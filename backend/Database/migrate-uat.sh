#!/bin/bash
# Explicit, repeatable schema-migration step for the UAT server (installed as /opt/vayuvata-uat/bin/migrate.sh).
# The API itself never changes the schema: its SQL login has no DDL rights and start-up does not migrate.
#
#   migrate.sh status   list applied / pending EF migrations, change nothing   (default)
#   migrate.sh apply    apply pending migrations; re-running is a safe no-op
#
# Uses the dedicated migration login (secret file, root only) - never the runtime login. The command refuses to run
# unless the database is named VayuVata and refuses ASPNETCORE_ENVIRONMENT=Production. It never drops or recreates anything.
set -euo pipefail
umask 077
[ "$(id -u)" -eq 0 ] || { echo "run as root (reads root-only secrets)"; exit 2; }
PASS="$(tr -d '\r\n' < /opt/vayuvata-uat/secrets/db-migrator.pass)"
export ASPNETCORE_ENVIRONMENT=Staging
export ConnectionStrings__Migration="Server=127.0.0.1,1433;Database=VayuVata;User Id=vayuvata_migrator;Password=${PASS};Encrypt=True;TrustServerCertificate=True;"
cd /opt/vayuvata-uat/app
case "${1:-status}" in
  status) exec ./VayuVata --migration-status ;;
  apply)  exec ./VayuVata --migrate ;;
  *) echo "usage: $0 [status|apply]"; exit 2 ;;
esac
