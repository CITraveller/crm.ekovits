import { pool, transaction } from "./db.js";

export function syncConfig() {
  const url = process.env.PORTAL_SYNC_URL || "";
  const token = process.env.PORTAL_SYNC_TOKEN || "";
  const enabled = process.env.PORTAL_SYNC_ENABLED === "true";
  if (
    enabled &&
    (!/^[a-f0-9]{64}$/i.test(token) ||
      url !== "https://portal.ekovits.com/api/integrations/crm/customers")
  ) {
    throw new Error(
      "Portal sync requires the Portal HTTPS endpoint and a 64-character hex token",
    );
  }
  return { enabled, url, token };
}

export async function sendNextCustomer(config = syncConfig(), send = fetch) {
  if (!config.enabled) return false;
  return transaction(async (client) => {
    // Hold the queue lock through delivery. Concurrent customer edits wait and
    // then enqueue a newer revision, rather than being lost behind an old ACK.
    const { rows } = await client.query(`SELECT * FROM portal_customer_sync
      WHERE revision>sent_revision AND next_attempt_at<=now()
      ORDER BY next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const item = rows[0];
    if (!item) return false;
    try {
      const response = await send(config.url, {
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
        }),
      });
      if (!response.ok) {
        const errors = {
          401: "Portal rejected the integration key.",
          409: "A matching Portal customer exists. Link it before retrying.",
          422: "Customer details are invalid. Check name, email and GSTIN.",
          503: "Portal integration is not configured.",
        };
        await response.body?.cancel();
        throw new Error(
          errors[response.status] || `Portal returned HTTP ${response.status}.`,
        );
      }
      const ack = await response.json();
      if (
        ack.customerId !== item.customer_id ||
        ack.revision !== String(item.revision) ||
        typeof ack.portalCustomerId !== "string"
      )
        throw new Error("Portal returned an invalid acknowledgement.");
      await client.query(
        `UPDATE portal_customer_sync SET sent_revision=$2,portal_customer_id=$3,
        attempts=0,last_error=NULL,synced_at=now() WHERE customer_id=$1`,
        [item.customer_id, item.revision, ack.portalCustomerId],
      );
    } catch (error) {
      const message =
        error.message.startsWith("Portal") ||
        error.message.startsWith("Customer") ||
        error.message.startsWith("A matching")
          ? error.message
          : "Portal could not be reached. Automatic retry scheduled.";
      const delay = Math.min(3600, 15 * 2 ** Math.min(item.attempts, 8));
      await client.query(
        `UPDATE portal_customer_sync SET attempts=attempts+1,last_error=$2,
        next_attempt_at=now()+($3*interval '1 second') WHERE customer_id=$1`,
        [item.customer_id, message, delay],
      );
    }
    return true;
  });
}

export function startPortalSync() {
  const config = syncConfig();
  if (!config.enabled) return;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      for (let i = 0; i < 10 && (await sendNextCustomer(config)); i++);
    } catch {
      console.error("Portal sync worker failed; it will retry.");
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
      await pool.query(`SELECT customer_id,payload->>'name' AS name,revision,sent_revision,
      portal_customer_id,attempts,last_error,synced_at,next_attempt_at,
      CASE WHEN revision=sent_revision THEN 'Synced' WHEN last_error IS NOT NULL THEN 'Retrying' ELSE 'Pending' END AS status
      FROM portal_customer_sync ORDER BY (revision>sent_revision) DESC,updated_at DESC LIMIT 500`);
    const totals = await pool.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE revision=sent_revision)::int AS synced,
      count(*) FILTER (WHERE revision>sent_revision)::int AS pending FROM portal_customer_sync`);
    res.json({
      enabled: process.env.PORTAL_SYNC_ENABLED === "true",
      ...totals.rows[0],
      rows,
    });
  });
  app.post("/api/integrations/portal/retry", admin, async (req, res) => {
    await pool.query(
      "UPDATE portal_customer_sync SET next_attempt_at=now(),attempts=0 WHERE revision>sent_revision",
    );
    res.json({ ok: true });
  });
}
