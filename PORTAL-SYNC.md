# Converted customer sync: CRM → Portal

Only customer accounts linked to a Converted CRM lead are synced. Unconverted
leads and manually created accounts without a converted lead are excluded.
Existing converted accounts are queued during migration. Future conversion and
customer edits enqueue in the same database transaction as the CRM change.

The backend attempts delivery every five seconds. Failures retry with a delay
from 15 seconds up to one hour, indefinitely. The queue survives restarts.
Admin users can open **Portal sync** in CRM to view status and retry pending
deliveries. The list shows up to 500 accounts with pending accounts first;
summary counts cover all accounts. The worker processes ten accounts per tick.

Portal accepts a dedicated 256-bit integration key on
`POST /api/integrations/crm/customers`. The key is stored only in server `.env`
files. The CRM endpoint is fixed to Portal HTTPS; redirects are rejected. No
database port is opened and neither app uses the other app's database password.
Do not place browser challenges on this API route in Cloudflare.

## Data and ownership

- Each Portal customer retains its own ID, with a unique CRM UUID mapping.
- Revision checks make repeated and out-of-order deliveries idempotent.
- CRM owns name, primary contact, address, email, phone, GSTIN, designation,
  alternate phone, notes and active status for linked accounts. Nonempty CRM
  values update those fields. Empty CRM fields preserve existing Portal values.
  Clear a value directly in Portal if required; automatic clearing is not supported.
- Portal-only shipping address, state/state code, PAN, country, PIN code, legal
  name and additional contacts stay in Portal. The API does not create fabricated
  billing/tax details. Complete missing details in Portal before issuing documents.
- Inactive CRM accounts become inactive Portal customers. On Hold remains active.
- Existing invoices and quotations are never updated by this integration.
- This is one-way customer sync. Portal edits do not flow back into CRM. No
  invoice or quote is automatically created.
- Existing Portal name/email/GSTIN matches return a conflict for explicit linking,
  rather than automatically merging potentially unrelated customers.
- Conversion shows success once saved in CRM; **Synced** confirms Portal delivery.

## First deployment (run on Ubuntu)

1. Pull the CRM release and find Portal's actual directory:

```bash
cd ~/crm.ekovits.com
git pull --ff-only origin main
PORTAL_DIR="$(docker inspect portal_backend --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}')"
printf 'Portal folder: %s\n' "$PORTAL_DIR"
test -f "$PORTAL_DIR/server/server.js"
```

Stop if a command fails. Take database backups before migration:

```bash
BACKUP_DIR="$HOME/backups/crm-portal-sync-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
docker exec portal_db pg_dump -U portal_app -d ekovits_invoice -Fc > "$BACKUP_DIR/portal.dump" &&
docker compose exec -T crm_db pg_dump -U crm_owner -d crm_module -Fc > "$BACKUP_DIR/crm.dump"
```

Stop if either backup fails. The installer verifies the exact four Portal source
hashes reviewed against the running container. It refuses unknown or already
patched sources. It backs up source, compose and both `.env` files into a private
folder under `~/backups`, generates the shared key, and leaves CRM sync disabled.
It does not touch or restart any containers.

```bash
python3 deploy/portal-integration/install.py "$PORTAL_DIR"
docker compose -f "$PORTAL_DIR/docker-compose.yml" --project-directory "$PORTAL_DIR" config --quiet
docker compose -f "$PORTAL_DIR/docker-compose.yml" --project-directory "$PORTAL_DIR" up -d --build --no-deps portal_backend
```

Check Portal before continuing (give startup migrations time to finish):

```bash
curl -fsS https://portal.ekovits.com/api/health
curl -sS -o /dev/null -w 'Integration HTTP: %{http_code}\n' -X POST https://portal.ekovits.com/api/integrations/crm/customers
```

Health should succeed; the unauthenticated integration request should return
**401**. 404 means the patch is not running; 503 means the key is not configured.
Stop and inspect `docker logs --tail 60 portal_backend` if either check fails.

Build CRM, run its owner migration, then enable delivery:

```bash
cd ~/crm.ekovits.com
docker compose build crm_backend crm_frontend &&
docker compose run --rm crm_migrate &&
sed -i 's/^PORTAL_SYNC_ENABLED=.*/PORTAL_SYNC_ENABLED=true/' .env &&
docker compose up -d --no-deps crm_backend crm_frontend
```

```bash
docker compose ps
curl -fsS https://crm.ekovits.com/api/health
```

Open CRM as Admin and select **Portal sync**. Confirm an existing converted
customer reaches **Synced**, refresh Portal and select that customer in a quote
or invoice draft. Check name/contact/billing details before issuing it. Converted
customers without a billing address still appear, but need their address filled.

This package patches Portal locally. Commit the new route, migration, helper,
`server/server.js` and compose change in Portal's own repository after deployment;
never commit `.env` or the backups. Preserve this patch on future Portal releases.

## Existing Portal customer conflicts

Identify the intended existing Portal account in its Customers screen and verify
its name/GSTIN/email. Obtain its ID from its API record; CRM ID is shown in
**Portal sync**. Link only the intended pair:

```bash
docker exec portal_backend node scripts/link-crm-customer.js CRM_CUSTOMER_UUID PORTAL_CUSTOMER_ID
```

The helper refuses a missing or already-linked Portal account. Click **Retry
pending** in CRM. Subsequent CRM updates will apply to that Portal account.

## Pause and rollback

To pause delivery without losing queued work:

```bash
cd ~/crm.ekovits.com
sed -i 's/^PORTAL_SYNC_ENABLED=.*/PORTAL_SYNC_ENABLED=false/' .env
docker compose up -d --no-deps crm_backend
```

The Portal schema changes are additive. Leave mapping columns and the queue in
place if reverting application code. To restore Portal source, use the installer's
printed protected backup to restore `server/server.js` and `docker-compose.yml`,
then rebuild only `portal_backend`. Do not restore databases casually: reverting
one database without reconciling mapping IDs/revisions can desynchronize accounts.

## Tests

`node --test tests/portal-sync.test.js` creates randomly named disposable schemas
inside the local development database. It tests conversion/rollback, auth,
delivery failure/retry, lost acknowledgements, duplicate/stale updates, billing
preservation, document update prevention, explicit linking, migration backfill,
and Admin-only status/retry routes. Never point test `DATABASE_URL` at production.
The small Portal fixtures are source/schema only from the verified backup; they
contain no customer data or credentials.
