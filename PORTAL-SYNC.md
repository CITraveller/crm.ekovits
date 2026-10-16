# Two-way CRM ↔ Portal customer sync (protocol 2)

All customer accounts, active and inactive, sync in both directions. This
includes manually created accounts, existing Portal accounts and converted CRM
leads. Unconverted leads are not customer accounts and are not copied.

The most recent edit to the shared account details wins, using database-generated
timestamps. This is account-level conflict resolution: the latest shared snapshot
wins, rather than combining individual fields from conflicting edits. Empty
values also sync, so clearing a shared field clears it on the other side. Portal
wins an exact timestamp tie. Keep both server database clocks synchronized.

Shared fields: customer name, billing address, primary contact name, designation,
primary email, primary phone, alternate phone, GSTIN, notes, and active/inactive
status. CRM's Prospect and On Hold statuses map to active in Portal. CRM-specific
lead assignments, website, industry and sales records stay in CRM. Portal-specific
state/state code, shipping address, PAN, country, PIN code, legal name and additional
contacts stay in Portal. Fill missing billing/tax details before issuing documents.

The integration never rewrites existing invoices or quotations, and never
automatically creates them. Permanent deletions do not propagate; use Inactive
to retain linked accounts. The normal Portal editing workflow remains unchanged.

## Delivery and identity

CRM saves a durable outgoing snapshot with each customer write. The worker pushes
up to ten pending records and reads a page of up to 100 Portal accounts every five
seconds. It scans all Portal accounts repeatedly, including inactive ones, so
changes are eventually found even across outages. An initial import may take
multiple cycles. Received changes retain their original modification time and do
not generate echo changes. Pending sends survive restarts; scan pagination restarts
from the beginning after a worker restart.

Each account has a stable CRM UUID and Portal ID mapping. Existing accounts link
automatically only when there is a unique exact GSTIN match, or a unique exact
company-name-and-email match, with no conflicting GSTIN or existing link.
Ambiguous/name-only matches are flagged for explicit linking instead of creating
duplicates. This matching policy cannot establish identity for incomplete records;
review flagged accounts in CRM's **Portal sync** screen.

The Admin-only screen shows outgoing status, last Portal check, incoming errors
and accounts requiring linking. It shows up to 500 outgoing rows and 100 import
conflicts; summary outgoing counts cover all accounts. Retry pending retries sends;
incoming polling continues automatically. Invalid records do not block other imports.

The API uses the existing shared integration key over HTTPS. It opens no database
ports and gives neither application access to the other's database credentials.
Cloudflare must allow this authenticated API route without browser challenges.

## Upgrade the installed one-way integration

Run on Ubuntu, one stage at a time. Stop on errors. The existing one-way
integration must already be installed, with CRM sync still disabled. If it was
enabled, first set `PORTAL_SYNC_ENABLED=false` in CRM's `.env` and recreate only
the CRM backend before applying the upgrade. Never paste `.env` contents.

Pull and take fresh backups:

```bash
cd ~/crm.ekovits.com &&
git pull --ff-only origin main &&
BACKUP_DIR="$HOME/backups/crm-portal-v2-$(date +%Y%m%d_%H%M%S)" &&
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR" &&
docker exec portal_db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP_DIR/portal.dump" &&
docker compose exec -T crm_db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP_DIR/crm.dump" &&
python3 deploy/portal-integration/upgrade.py "$HOME/Portal.ekovits.com"
```

The upgrade checks the reviewed v1 route hash, confirms existing keys match and
sync is disabled, saves a backup, then replaces only the integration route and adds
a migration. It preserves credentials, other Portal source and the compose project.
It refuses unknown or already-upgraded versions. Containers are not restarted.

Rebuild Portal with the exact existing project name:

```bash
cd ~/Portal.ekovits.com &&
docker compose -p portalekovitscom config --quiet &&
docker compose -p portalekovitscom up -d --build --no-deps portal_backend
```

Check the authenticated API from inside Portal without printing any credentials
or customer details (run after Portal startup completes):

```bash
docker exec portal_backend node --input-type=module -e '
const r = await fetch("http://127.0.0.1:5000/api/integrations/crm/customers", {
  headers: { Authorization: "Bearer " + process.env.CRM_SYNC_TOKEN }
});
if (!r.ok) { console.error("HTTP", r.status); process.exit(1); }
const body = await r.json();
console.log("Sync protocol:", body.protocol);
console.log("Accounts in first page:", body.rows?.length);
if (body.protocol !== 2) process.exit(1);
'
curl -fsS https://portal.ekovits.com/api/health
```

Only continue when protocol is **2** and health succeeds. Now migrate CRM and
enable both directions:

```bash
cd ~/crm.ekovits.com &&
docker compose build crm_backend crm_frontend &&
docker compose run --rm crm_migrate &&
sed -i 's/^PORTAL_SYNC_ENABLED=.*/PORTAL_SYNC_ENABLED=true/' .env &&
docker compose up -d --no-deps crm_backend crm_frontend
```

```bash
docker compose ps
curl -fsS https://crm.ekovits.com/api/health
```

Open **Portal sync** in CRM as Admin. Wait for outgoing rows to become Synced and
the last Portal check to appear. Refresh both applications; verify an active and
an inactive account. Change a test account's primary contact in each application,
one change at a time, and confirm its counterpart updates. Inactive accounts will
remain in customer lists but will not be offered in Portal's active-client selectors.

Commit the patched route and new migration in Portal's own repository separately.
Do not commit credentials or backups. Preserve the integration patch on subsequent
Portal deployments; do not overwrite it with the unpatched old backup.

## Fresh installation

`install.py` still supports the originally reviewed Portal version. It installs
both migrations and the current route, creates matching keys, and leaves sync
disabled. Take backups first, run it with the actual Portal folder path, then use
the Portal rebuild/check and CRM migration/enable stages above. Do not run the
fresh installer over an existing integration; use `upgrade.py` for v1 instead.

## Resolve flagged identities

Verify the intended pair using the customer names, email and GSTIN. Find the CRM
UUID in the sync screen and the Portal ID in its import-conflict row/API record.
Then link that exact pair using the existing helper:

```bash
docker exec portal_backend node scripts/link-crm-customer.js CRM_CUSTOMER_UUID PORTAL_CUSTOMER_ID
```

The helper refuses an already-linked Portal customer. The next scan uses this
mapping and resolves data using the latest edit time. An incorrect or conflicting
existing link needs review, not a forced overwrite.

## Pause or recover

```bash
cd ~/crm.ekovits.com
sed -i 's/^PORTAL_SYNC_ENABLED=.*/PORTAL_SYNC_ENABLED=false/' .env
docker compose up -d --no-deps crm_backend
```

This pauses both directions while retaining the queues and linked records. Leave
additive schema columns in place if reverting code. Do not restore just one
database without reconciling mappings and timestamps, as that can desynchronize
accounts. Protocol 1 and protocol 2 workers/endpoints are not interchangeable;
keep sync disabled until both applications have the same version.

## Validation

`node --test tests/portal-sync.test.js` uses disposable schemas in the local
development database, with the verified Portal schema. It covers both directions,
manual/inactive accounts, latest-edit conflicts, auth, retries, missing ACKs,
duplicate/loop prevention, matching, ambiguous identities, preservation of
Portal-only fields and document-update prevention. Never run it against production.
