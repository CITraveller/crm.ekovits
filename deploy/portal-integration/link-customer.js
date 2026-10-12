// Run inside Portal: node scripts/link-crm-customer.js <CRM UUID> <Portal ID>
import { pool, withTransaction } from "../db/connection.js";
const [crmId, portalId] = process.argv.slice(2);
try {
  if (!/^[0-9a-f-]{36}$/i.test(crmId || "") || !portalId)
    throw new Error(
      "Provide CRM customer UUID and existing Portal customer ID",
    );
  await withTransaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(72819411)");
    const { rows } = await c.query(
      "SELECT id,name,crm_customer_id FROM customers WHERE id=$1 FOR UPDATE",
      [portalId],
    );
    if (!rows.length || rows[0].crm_customer_id)
      throw new Error("Customer missing or already linked");
    await c.query(
      "UPDATE customers SET crm_customer_id=$1,crm_revision=0 WHERE id=$2",
      [crmId, portalId],
    );
    console.log("Linked Portal customer:", rows[0].name);
  });
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
