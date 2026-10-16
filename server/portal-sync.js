import { randomUUID } from "node:crypto";
import { pool, transaction } from "./db.js";
import { schemas } from "./validation.js";
export function syncConfig() {
  const url = process.env.PORTAL_SYNC_URL || "",
    token = process.env.PORTAL_SYNC_TOKEN || "",
    enabled = process.env.PORTAL_SYNC_ENABLED === "true";
  if (
    enabled &&
    (!/^[a-f0-9]{64}$/i.test(token) ||
      url !== "https://portal.ekovits.com/api/integrations/crm/customers")
  )
    throw new Error(
      "Portal sync requires the Portal HTTPS endpoint and a 64-character hex token",
    );
  return { enabled, url, token };
}
const norm = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();
export function fromPortal(row, previous = {}) {
  return schemas.customers.parse({
    ...previous,
    name: row.name,
    company:
      !previous.company || previous.company === previous.name
        ? row.name
        : previous.company,
    address: row.billing_address || "",
    contact_name: row.contact_person || "",
    designation: row.designation || "",
    contact_email: row.email || "",
    email: row.email || "",
    contact_phone: row.contact_number || "",
    phone: row.contact_number || "",
    gstin: row.gstin || "",
    alternate_phone: row.alternate_phone || "",
    notes: row.notes || "",
    status: row.active
      ? previous.status && previous.status !== "Inactive"
        ? previous.status
        : "Active"
      : "Inactive",
    source: previous.source || "Portal",
  });
}
function validRecord(row) {
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.active !== "boolean" ||
    !Number.isFinite(new Date(row.sync_modified_at).getTime())
  )
    throw new Error("Portal returned an invalid customer record.");
}
async function applyRemote(client, local, queue, record) {
  validRecord(record);
  if (record.crm_customer_id && record.crm_customer_id !== local.id)
    throw new Error("Portal customer identity conflict.");
  if (new Date(record.sync_modified_at) < new Date(queue.modified_at))
    return false;
  const data = fromPortal(record, local.data);
  await client.query("SELECT set_config('crm.portal_inbound','1',true)");
  await client.query(
    `UPDATE customers SET data=$2,version=version+1,updated_at=$3 WHERE id=$1 AND data IS DISTINCT FROM $2::jsonb`,
    [local.id, data, record.sync_modified_at],
  );
  await client.query(
    `UPDATE portal_customer_sync SET payload=$2,modified_at=$3,portal_customer_id=$4,
  sent_revision=CASE WHEN $5 THEN revision ELSE sent_revision END,last_error=NULL,attempts=0,synced_at=CASE WHEN $5 THEN now() ELSE synced_at END WHERE customer_id=$1`,
    [
      local.id,
      data,
      record.sync_modified_at,
      record.id,
      Boolean(record.crm_customer_id),
    ],
  );
  return true;
}
async function readResponse(response) {
  if (!response.ok) {
    const errors = {
      401: "Portal rejected the integration key.",
      409: "A matching account needs explicit linking. See the import conflicts below.",
      422: "Customer data or sync version is invalid. Check the account and Portal deployment.",
      503: "Portal integration is unavailable.",
    };
    await response.body?.cancel();
    throw new Error(
      errors[response.status] || `Portal returned HTTP ${response.status}.`,
    );
  }
  return response.json();
}
export async function sendNextCustomer(config = syncConfig(), send = fetch) {
  if (!config.enabled) return false;
  return transaction(async (client) => {
    // Always lock customer before queue, matching the write triggers.
    const local = (
      await client.query(`SELECT c.* FROM customers c JOIN portal_customer_sync q ON q.customer_id=c.id
   WHERE q.revision>q.sent_revision AND q.next_attempt_at<=now() ORDER BY q.next_attempt_at LIMIT 1 FOR UPDATE OF c SKIP LOCKED`)
    ).rows[0];
    if (!local) return false;
    const item = (
      await client.query(
        "SELECT * FROM portal_customer_sync WHERE customer_id=$1 FOR UPDATE",
        [local.id],
      )
    ).rows[0];
    try {
      const ack = await readResponse(
        await send(config.url, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.token}`,
          },
          body: JSON.stringify({
            customerId: item.customer_id,
            revision: String(item.revision),
            customer: item.payload,
            modifiedAt: item.modified_at.toISOString(),
            ...(item.portal_customer_id
              ? { portalCustomerId: item.portal_customer_id }
              : {}),
          }),
        }),
      );
      if (
        ack.protocol !== 2 ||
        ack.customerId !== item.customer_id ||
        ack.revision !== String(item.revision) ||
        !ack.record ||
        ack.portalCustomerId !== ack.record.id ||
        ack.record.crm_customer_id !== local.id
      )
        throw new Error(
          "Portal returned an invalid acknowledgement. Deploy two-way sync on Portal first.",
        );
      if (!(await applyRemote(client, local, item, ack.record)))
        throw new Error("Portal returned an older account version.");
      await client.query(
        "UPDATE portal_customer_sync SET sent_revision=revision,synced_at=now(),last_error=NULL,attempts=0 WHERE customer_id=$1",
        [local.id],
      );
    } catch (e) {
      const message = /^(Portal|Customer|A matching)/.test(e.message)
        ? e.message
        : "Customer sync failed. Check customer details; automatic retry scheduled.";
      const delay = Math.min(3600, 15 * 2 ** Math.min(item.attempts, 8));
      await client.query(
        `UPDATE portal_customer_sync SET attempts=attempts+1,last_error=$2,next_attempt_at=now()+($3*interval '1 second') WHERE customer_id=$1`,
        [local.id, message, delay],
      );
    }
    return true;
  });
}
async function conflict(client, row, reason) {
  await client.query(
    `INSERT INTO portal_import_conflicts(portal_id,name,reason) VALUES($1,$2,$3) ON CONFLICT(portal_id) DO UPDATE SET name=EXCLUDED.name,reason=EXCLUDED.reason,seen_at=now()`,
    [row.id, row.name || "Unnamed account", reason],
  );
}
export async function importPortalCustomer(row) {
  validRecord(row);
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(72819412)");
    let local = (
      await client.query(
        `SELECT c.* FROM customers c LEFT JOIN portal_customer_sync q ON q.customer_id=c.id WHERE c.id=$1 OR q.portal_customer_id=$2 FOR UPDATE OF c`,
        [row.crm_customer_id || null, row.id],
      )
    ).rows;
    if (local.length > 1) {
      await conflict(
        client,
        row,
        "Conflicting existing links. Review customer identities.",
      );
      return;
    }
    local = local[0];
    if (!local) {
      const candidates = (
        await client.query(
          `SELECT c.* FROM customers c WHERE lower(trim(data->>'name'))=lower(trim($1))
    OR ($2<>'' AND lower(trim(COALESCE(NULLIF(data->>'contact_email',''),data->>'email')))=lower(trim($2)))
    OR ($3<>'' AND upper(trim(data->>'gstin'))=upper(trim($3))) FOR UPDATE`,
          [row.name, row.email || "", row.gstin || ""],
        )
      ).rows;
      if (candidates.length) {
        const c = candidates[0],
          gst = norm(c.data.gstin),
          email = norm(c.data.contact_email || c.data.email);
        const strong =
          (gst && gst === norm(row.gstin)) ||
          (email &&
            email === norm(row.email) &&
            norm(c.data.name) === norm(row.name));
        const conflictingGst =
          gst && norm(row.gstin) && gst !== norm(row.gstin);
        const linked = (
          await client.query(
            "SELECT portal_customer_id FROM portal_customer_sync WHERE customer_id=$1",
            [c.id],
          )
        ).rows[0]?.portal_customer_id;
        if (
          candidates.length !== 1 ||
          !strong ||
          conflictingGst ||
          (linked && linked !== row.id) ||
          (row.crm_customer_id && row.crm_customer_id !== c.id)
        ) {
          await conflict(
            client,
            row,
            "Existing CRM match needs explicit linking. Verify company, email and GSTIN before linking.",
          );
          return;
        }
        local = c;
      }
    }
    if (!local) {
      const id = row.crm_customer_id || randomUUID(),
        data = fromPortal(row);
      await client.query("SELECT set_config('crm.portal_inbound','1',true)");
      local = (
        await client.query(
          "INSERT INTO customers(id,data,updated_at) VALUES($1,$2,$3) RETURNING *",
          [id, data, row.sync_modified_at],
        )
      ).rows[0];
      await client.query(
        `INSERT INTO portal_customer_sync(customer_id,payload,portal_customer_id,modified_at,sent_revision,synced_at) VALUES($1,$2,$3,$4,$5,CASE WHEN $5::bigint=1 THEN now() ELSE NULL END)`,
        [id, data, row.id, row.sync_modified_at, row.crm_customer_id ? 1 : 0],
      );
    } else {
      const queue = (
        await client.query(
          "SELECT * FROM portal_customer_sync WHERE customer_id=$1 FOR UPDATE",
          [local.id],
        )
      ).rows[0];
      if (!queue)
        throw new Error("Customer queue missing; run the CRM migration.");
      if (queue.portal_customer_id && queue.portal_customer_id !== row.id) {
        await conflict(
          client,
          row,
          "Customer already linked to another Portal account.",
        );
        return;
      }
      const changed = await applyRemote(client, local, queue, row);
      if (!row.crm_customer_id || !changed) {
        await client.query(
          `UPDATE portal_customer_sync SET portal_customer_id=$2,
      revision=CASE WHEN sent_revision=revision THEN revision+1 ELSE revision END,next_attempt_at=now() WHERE customer_id=$1`,
          [local.id, row.id],
        );
      }
    }
    await client.query(
      "DELETE FROM portal_import_conflicts WHERE portal_id=$1",
      [row.id],
    );
  });
}
export async function pullPortalPage(
  config = syncConfig(),
  after = "",
  send = fetch,
) {
  if (!config.enabled) return "";
  const url = new URL(config.url);
  if (after) url.searchParams.set("after", after);
  try {
    const page = await readResponse(
      await send(url, {
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${config.token}` },
      }),
    );
    if (
      page.protocol !== 2 ||
      !Array.isArray(page.rows) ||
      page.rows.length > 100 ||
      !(page.next === null || typeof page.next === "string")
    )
      throw new Error("Portal does not have two-way sync installed.");
    for (const row of page.rows) {
      try {
        await importPortalCustomer(row);
      } catch (e) {
        validRecord(row);
        await conflict(
          pool,
          row,
          "Account could not be imported. Check field lengths, email and customer identity.",
        );
      }
    }
    await pool.query(
      "UPDATE portal_sync_health SET last_pull_at=now(),last_error=NULL WHERE id=1",
    );
    return page.next || "";
  } catch (e) {
    await pool.query("UPDATE portal_sync_health SET last_error=$1 WHERE id=1", [
      "Portal customer import failed. Check the API key, connection and Portal deployment.",
    ]);
    return after;
  }
}
export function startPortalSync() {
  const config = syncConfig();
  if (!config.enabled) return;
  let busy = false,
    cursor = "";
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      for (let i = 0; i < 10 && (await sendNextCustomer(config)); i++);
      cursor = await pullPortalPage(config, cursor);
    } catch {
      console.error("Customer sync worker failed; retrying.");
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(tick, 5000);
  timer.unref();
}
export function registerPortalSyncRoutes(app, admin) {
  app.get("/api/integrations/portal", admin, async (req, res) => {
    const { rows } =
      await pool.query(`SELECT customer_id,payload->>'name' AS name,revision,sent_revision,portal_customer_id,attempts,last_error,synced_at,modified_at,next_attempt_at,
   CASE WHEN revision=sent_revision THEN 'Synced' WHEN last_error IS NOT NULL THEN 'Retrying' ELSE 'Pending' END AS status FROM portal_customer_sync ORDER BY (revision>sent_revision) DESC,updated_at DESC LIMIT 500`);
    const totals = (
      await pool.query(
        `SELECT count(*)::int AS total,count(*) FILTER(WHERE revision=sent_revision)::int AS synced,count(*) FILTER(WHERE revision>sent_revision)::int AS pending FROM portal_customer_sync`,
      )
    ).rows[0];
    const health = (
      await pool.query("SELECT * FROM portal_sync_health WHERE id=1")
    ).rows[0];
    const conflicts = (
      await pool.query(
        "SELECT * FROM portal_import_conflicts ORDER BY seen_at DESC LIMIT 100",
      )
    ).rows;
    res.json({
      enabled: process.env.PORTAL_SYNC_ENABLED === "true",
      ...totals,
      rows,
      health,
      conflicts,
    });
  });
  app.post("/api/integrations/portal/retry", admin, async (req, res) => {
    await pool.query(
      "UPDATE portal_customer_sync SET next_attempt_at=now(),attempts=0 WHERE revision>sent_revision",
    );
    res.json({ ok: true });
  });
}
