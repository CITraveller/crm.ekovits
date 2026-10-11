# Orbit CRM

React frontend, Node.js/Express API, and PostgreSQL database. The application runs locally; it is not a cloud deployment.

## Open the application

- Frontend: http://127.0.0.1:5188
- API health: http://127.0.0.1:4310/api/health
- Admin email: `admin@crm.local`
- Generated password: `.local/login.txt` (local private file)
- Dedicated PostgreSQL instance: `127.0.0.1:55432`, database `crm_module`

Run these commands from this `crm` directory in PowerShell:

```powershell
./scripts/start-local-db.ps1
npm.cmd run dev
```

Keep the terminal running while using the app. Ctrl+C stops the frontend/API. PostgreSQL runs separately and persists data under `.local/postgres-data`.

## Install on another machine

Use Node.js 24 or a compatible supported Node version and PostgreSQL. Run `npm ci`, copy `.env.example` to `.env`, and configure `DATABASE_URL`, a unique initial administrator password, and the application origin. Create the target database before migrating. Then:

```powershell
npm.cmd run db:migrate
npm.cmd run dev
```

On Windows with PostgreSQL 18 installed at the standard path, `scripts/setup-local.ps1` can initialize an independent loopback-only cluster on port 55432. It refuses to overwrite an existing `.env`. If initialization succeeded but starting the process was interrupted, run `scripts/start-local-db.ps1`, then `node scripts/finish-local.js`, then the migration.

The administrator is created only when the users table is empty. Changing `ADMIN_PASSWORD` afterward does not reset an existing account. An administrator can reset team passwords through Team members.

## Included workflows

- Dashboard metrics, trend periods, sources, stage counts, recent leads, today's tasks and upcoming activities.
- Lead list/board, search, stage/source/assignee filters, sorting, configurable columns, pagination, page selection, and Excel import/export.
- Customer accounts, primary contact details in forms, related contact information and business records in details, status changes and comments.
- Transactional lead conversion with existing-account matching, activity transfer, linked original leads, history, and irreversible converted status.
- Opportunities with required customer links, stages, value, probability and expected closing date.
- Calls, meetings, email work items, tasks and follow-ups with owners, due dates/times, priorities and statuses. Email activities do not send email.
- Record dialogs with edit forms, expansion, Escape dismissal, comments/history and optimistic version checks.
- Global search, customer-industry and lead-stage reports, company settings and additional lead stages.
- Admin, Sales Manager, Sales Executive and Viewer roles, enforced on the API and in the interface. Last-admin and self-demotion safeguards are enforced server-side.

Board columns display the current page of filtered records. Imports accept `.xlsx` files, up to 5 MB compressed, 40 MB expanded and 10,000 rows. Export an empty lead list to obtain column headers. `name` is required; non-empty emails must be valid and unique. Imports create New/Contacted or other configured non-converted stages; convert records inside CRM. The import summary shows the first 100 errors and complete success/failure counts. Export supports selected or filtered records, up to 50,000 rows. Money is displayed in INR; the local database uses Asia/Kolkata dates.

## Verification

```powershell
npm.cmd test
npm.cmd run build
npm.cmd audit
```

Integration tests use the configured database and temporary records with unique QA names, then clean up their own records. Run them on the dedicated development database, not a live customer database. They cover authentication, role restrictions, validation, duplicates, combined filters, conversion and concurrent updates, activity linking, status history/comments, Excel import/export, opportunities, administrator safeguards and origin validation.

## Configuration and deployment notes

Local secrets and database data are excluded by `.gitignore`. Do not distribute `.env`, `.local`, or database backups with source code. The development cluster's `crm_app` account owns the cluster; use a separate least-privilege runtime database role for a production deployment.

`npm run build` creates the frontend in `dist`. `npm start` serves the built app and API together on port 4310. For that mode, set `APP_ORIGIN=http://127.0.0.1:4310` locally. A production deployment requires HTTPS, `NODE_ENV=production`, the actual HTTPS origin, managed secrets, a reverse proxy and a backed-up database. Secure session cookies are enabled in production.

This is a single-workspace local application. It does not include SSO/MFA, multi-tenant isolation, email delivery, automated backups, or a production load/security certification. Browser WebMCP support is optional and exposes authenticated record search and opening record details; ordinary controls work without it.

Application data uses validated JSONB record fields with relational foreign keys for users, lead/customer/activity links, transactionally written history and version-based conflict detection. The schema migration is repeatable and preserves existing rows. Synced project reference files under the parent `sources` directory are not modified.
