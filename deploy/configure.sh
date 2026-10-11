#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -e .env ]]; then
  echo '.env already exists; preserving it. Do not regenerate database passwords for an existing volume.'
  exit 1
fi
command -v openssl >/dev/null || { echo 'Install openssl first.'; exit 1; }
umask 077
db_password=$(openssl rand -hex 32)
app_password=$(openssl rand -hex 32)
admin_password=$(openssl rand -hex 24)
cat > .env <<EOF
CRM_DB_PASSWORD=$db_password
CRM_APP_PASSWORD=$app_password
ADMIN_EMAIL=admin@ekovits.com
ADMIN_PASSWORD=$admin_password
CRM_FRONTEND_PORT=3006
CRM_BACKEND_PORT=5006
EOF
echo 'Created private server configuration in .env.'
echo 'Initial administrator email: admin@ekovits.com'
echo 'Read the initial password with: sed -n "s/^ADMIN_PASSWORD=//p" .env'
echo 'Do not send .env or its passwords in chat or commit them to Git.'
