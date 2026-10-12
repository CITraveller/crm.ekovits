import express from "express";
import { timingSafeEqual } from "node:crypto";
import { withTransaction } from "../db/connection.js";
import { uid } from "../utils/ids.js";
import { validateEmail, validateGstin } from "../utils/validation.js";
import { audit } from "../services/auditService.js";

const fail = (status, message) => Object.assign(new Error(message), { status });
export function authorizeCrm(req, res, next) {
  const key = process.env.CRM_SYNC_TOKEN || "";
  if (!/^[a-f0-9]{64}$/i.test(key))
    return res.status(503).json({ error: "Integration unavailable" });
  const actual = Buffer.from(req.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${key}`);
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
    customerId: body.customerId,
    revision: String(body.revision),
    customer: c,
  };
}
export async function receiveCustomer(body, transact = withTransaction) {
  const { customerId, revision, customer: c } = validatePayload(body);
  return transact(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(72819411)");
    let old = (
      await client.query(
        "SELECT * FROM customers WHERE crm_customer_id=$1 FOR UPDATE",
        [customerId],
      )
    ).rows[0];
    if (old && BigInt(old.crm_revision) >= BigInt(revision))
      return { customerId, revision, portalCustomerId: old.id };
    const email = c.contact_email || c.email || "";
    const gstin = (c.gstin || "").toUpperCase();
    if (!old) {
      const matches = await client.query(
        `SELECT id FROM customers WHERE
        lower(trim(name))=lower(trim($1)) OR ($2<>'' AND lower(email)=lower($2)) OR ($3<>'' AND upper(gstin)=$3)`,
        [c.name, email, gstin],
      );
      if (matches.rows.length)
        throw fail(409, "Existing customer needs explicit linking");
    }
    const id = old?.id || uid("cust");
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
    ];
    if (!old) {
      // Blank billing/state details are deliberately not invented. Portal staff
      // complete them before issuing documents. These are ordinary customers.
      await client.query(
        `INSERT INTO customers(id,name,billing_address,contact_person,contact_number,email,gstin,designation,alternate_phone,notes,active,crm_customer_id,crm_revision,state,state_code,customer_type)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'','','Sales Customer Account')`,
        values,
      );
    } else {
      // Preserve Portal-only billing fields and empty CRM fields. Do not call
      // updateCustomer: it rewrites historical invoice/quotation snapshots.
      await client.query(
        `UPDATE customers SET name=$2,billing_address=COALESCE(NULLIF($3,''),billing_address),
        contact_person=COALESCE(NULLIF($4,''),contact_person),contact_number=COALESCE(NULLIF($5,''),contact_number),
        email=COALESCE(NULLIF($6,''),email),gstin=COALESCE(NULLIF($7,''),gstin),designation=COALESCE(NULLIF($8,''),designation),
        alternate_phone=COALESCE(NULLIF($9,''),alternate_phone),notes=COALESCE(NULLIF($10,''),notes),active=$11,
        crm_customer_id=$12,crm_revision=$13,updated_at=now() WHERE id=$1`,
        values,
      );
    }
    const current = (
      await client.query("SELECT * FROM customers WHERE id=$1", [id])
    ).rows[0];
    await audit(
      "CRM Customer Synced",
      "customer",
      id,
      c.name,
      old || null,
      current,
      "Converted CRM customer API",
      client,
    );
    return { customerId, revision, portalCustomerId: id };
  });
}
export const crmIntegrationRouter = express.Router();
crmIntegrationRouter.use(authorizeCrm);
crmIntegrationRouter.post("/customers", async (req, res, next) => {
  try {
    res.json(await receiveCustomer(req.body));
  } catch (error) {
    next(error);
  }
});
