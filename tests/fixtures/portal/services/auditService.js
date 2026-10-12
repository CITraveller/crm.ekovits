import { query } from "../db/connection.js";
import { uid } from "../utils/ids.js";

export async function audit(action, entityType, entityId, description = "", oldValue = null, newValue = null, reason = "", client = null, invoiceNo = null) {
  const runner = client || { query };
  const id = uid("aud");
  await runner.query(
    `INSERT INTO audit_logs (id, action, entity_type, entity_id, invoice_no, description, old_value, new_value, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, action, entityType, entityId, invoiceNo, description, oldValue, newValue, reason]
  );
  return id;
}

export async function listAudit(search = "") {
  const params = [];
  let where = "";
  if (search) {
    params.push(`%${search}%`);
    where = "WHERE action ILIKE $1 OR description ILIKE $1 OR invoice_no ILIKE $1 OR reason ILIKE $1";
  }
  const { rows } = await query(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT 500`, params);
  return rows.map(row => ({
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    invoiceNo: row.invoice_no,
    description: row.description,
    oldValue: row.old_value,
    newValue: row.new_value,
    reason: row.reason,
    createdAt: row.created_at
  }));
}
