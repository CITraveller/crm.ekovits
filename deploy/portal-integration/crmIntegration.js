import express from "express";
import { timingSafeEqual } from "node:crypto";
import { query, withTransaction } from "../db/connection.js";
import { uid } from "../utils/ids.js";
import { validateEmail, validateGstin } from "../utils/validation.js";
import { audit } from "../services/auditService.js";
const fail = (status, message) => Object.assign(new Error(message), { status });
const norm = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();
export function authorizeCrm(req, res, next) {
  const key = process.env.CRM_SYNC_TOKEN || "";
  if (!/^[a-f0-9]{64}$/i.test(key))
    return res.status(503).json({ error: "Integration unavailable" });
  const actual = Buffer.from(req.get("authorization") || ""),
    expected = Buffer.from(`Bearer ${key}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return res.status(401).json({ error: "Unauthorized" });
  next();
}
export function validatePayload(body) {
  if (
    !body ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      body.customerId || "",
    ) ||
    !/^[1-9][0-9]{0,14}$/.test(String(body.revision))
  )
    throw fail(422, "Invalid customer identity");
  const modified = new Date(body.modifiedAt);
  if (
    typeof body.modifiedAt !== "string" ||
    !Number.isFinite(modified.getTime()) ||
    modified.getTime() > Date.now() + 60000
  )
    throw fail(422, "Invalid modification time");
  if (
    body.portalCustomerId !== undefined &&
    (typeof body.portalCustomerId !== "string" ||
      body.portalCustomerId.length > 200)
  )
    throw fail(422, "Invalid Portal identity");
  const c = body.customer;
  if (!c || typeof c !== "object" || Array.isArray(c))
    throw fail(422, "Invalid customer");
  for (const [key, value] of Object.entries(c))
    if (
      typeof value !== "string" ||
      value.length > (key === "notes" ? 10000 : 500)
    )
      throw fail(422, "Invalid field");
  if (
    !c.name?.trim() ||
    !["Active", "Prospect", "On Hold", "Inactive"].includes(c.status) ||
    !validateEmail(c.contact_email || c.email || "") ||
    !validateGstin(c.gstin || "")
  )
    throw fail(422, "Invalid customer details");
  return {
    ...body,
    revision: String(body.revision),
    modifiedAt: modified.toISOString(),
  };
}
export function confidentMatch(row, c) {
  const gst = norm(c.gstin),
    email = norm(c.contact_email || c.email);
  if (gst && norm(row.gstin) && gst !== norm(row.gstin)) return false;
  return Boolean(
    (gst && gst === norm(row.gstin)) ||
    (email && email === norm(row.email) && norm(row.name) === norm(c.name)),
  );
}
export async function listSyncCustomers(after = "", runner = { query }) {
  if (typeof after !== "string" || after.length > 200)
    throw fail(422, "Invalid cursor");
  const { rows } = await runner.query(
    "SELECT * FROM customers WHERE id>$1 ORDER BY id LIMIT 100",
    [after],
  );
  return {
    protocol: 2,
    rows,
    next: rows.length === 100 ? rows.at(-1).id : null,
  };
}
export async function receiveCustomer(body, transact = withTransaction) {
  const {
    customerId,
    revision,
    customer: c,
    modifiedAt,
    portalCustomerId,
  } = validatePayload(body);
  return transact(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(72819411)");
    let old = (
      await client.query(
        "SELECT * FROM customers WHERE crm_customer_id=$1 FOR UPDATE",
        [customerId],
      )
    ).rows[0];
    if (portalCustomerId && old && old.id !== portalCustomerId)
      throw fail(409, "Customer identity conflict");
    if (!old && portalCustomerId) {
      old = (
        await client.query("SELECT * FROM customers WHERE id=$1 FOR UPDATE", [
          portalCustomerId,
        ])
      ).rows[0];
      if (!old || (old.crm_customer_id && old.crm_customer_id !== customerId))
        throw fail(409, "Customer identity conflict");
    }
    const email = c.contact_email || c.email || "",
      gstin = (c.gstin || "").toUpperCase();
    if (!old) {
      const matches = (
        await client.query(
          `SELECT * FROM customers WHERE lower(trim(name))=lower(trim($1)) OR ($2<>'' AND lower(trim(email))=lower(trim($2))) OR ($3<>'' AND upper(trim(gstin))=$3) FOR UPDATE`,
          [c.name, email, gstin],
        )
      ).rows;
      if (matches.length) {
        if (
          matches.length !== 1 ||
          matches[0].crm_customer_id ||
          !confidentMatch(matches[0], c)
        )
          throw fail(409, "Existing customer needs explicit linking");
        old = matches[0];
      }
    }
    const id = old?.id || uid("cust");
    await client.query("SELECT set_config('crm.sync_inbound','1',true)");
    if (!old || new Date(modifiedAt) > new Date(old.sync_modified_at)) {
      const values = [
        id,
        c.name,
        c.address || "",
        c.contact_name || "",
        c.contact_phone || c.phone || "",
        email,
        gstin,
        c.designation || "",
        c.alternate_phone || "",
        c.notes || "",
        c.status !== "Inactive",
        customerId,
        revision,
        modifiedAt,
      ];
      if (!old)
        await client.query(
          `INSERT INTO customers(id,name,billing_address,contact_person,contact_number,email,gstin,designation,alternate_phone,notes,active,crm_customer_id,crm_revision,sync_modified_at,state,state_code,customer_type)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'','','Sales Customer Account')`,
          values,
        );
      else
        await client.query(
          `UPDATE customers SET name=$2,billing_address=$3,contact_person=$4,contact_number=$5,email=$6,gstin=$7,designation=$8,alternate_phone=$9,notes=$10,active=$11,crm_customer_id=$12,crm_revision=$13,sync_modified_at=$14,updated_at=now() WHERE id=$1`,
          values,
        );
      await audit(
        "Customer Synced from CRM",
        "customer",
        id,
        c.name,
        old || null,
        c,
        "Latest account edit wins; documents unchanged",
        client,
      );
    } else if (!old.crm_customer_id) {
      await client.query(
        "UPDATE customers SET crm_customer_id=$1 WHERE id=$2",
        [customerId, id],
      );
      await audit(
        "CRM Customer Linked",
        "customer",
        id,
        old.name,
        null,
        { crmCustomerId: customerId },
        "Existing account linked",
        client,
      );
    }
    const record = (
      await client.query("SELECT * FROM customers WHERE id=$1", [id])
    ).rows[0];
    return { protocol: 2, customerId, revision, portalCustomerId: id, record };
  });
}
export const crmIntegrationRouter = express.Router();
crmIntegrationRouter.use(authorizeCrm);
crmIntegrationRouter.get("/customers", async (req, res, next) => {
  try {
    res.json(await listSyncCustomers(req.query.after || ""));
  } catch (e) {
    next(e);
  }
});
crmIntegrationRouter.post("/customers", async (req, res, next) => {
  try {
    res.json(await receiveCustomer(req.body));
  } catch (e) {
    next(e);
  }
});
