# Delete leads and customers from CRM

Administrators can open a lead or customer, choose **Delete lead** or **Delete
customer**, and type the exact record name to confirm. Other roles cannot delete
through either the interface or API. If the record changed since it was opened,
reopen it before deleting.

- Deleting a lead preserves its customer and activities. Activities are detached
  from the deleted lead. Its email can be used on a corrected lead.
- Deleting a customer preserves its leads and activities, but clears their customer
  links. Converted leads retain their historical Converted stage. Delete those
  leads separately if they are also unwanted.
- Customers with opportunities cannot be deleted. Reassign their opportunities to
  the appropriate customer first.
- This action removes records from CRM only. Portal customers, invoices and quotes
  remain. A saved exclusion prevents the linked Portal customer from being
  imported back into CRM, including after sync restarts.
- A database audit snapshot records the deleted record, administrator, date and
  Portal mapping. Existing history is retained. There is no restore button in this
  release; recovering an accidentally deleted record requires administrator support.

## Deploy

From `~/crm.ekovits.com` on Ubuntu:

```bash
git pull --ff-only origin main &&
docker compose build crm_backend crm_frontend &&
docker compose run --rm crm_migrate &&
docker compose up -d --no-deps crm_backend crm_frontend
```

The migration adds the deletion audit/exclusion table and grants the runtime role
access through the existing migration helper. It does not delete any accounts.
Portal does not need to be rebuilt. Refresh CRM after deployment.

Tests cover administrator-only access, stale confirmations, opportunities,
relationship preservation, audit snapshots, reuse of incorrect lead emails and
suppression of deleted accounts during Portal imports.
