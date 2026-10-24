import { registerDeletion } from "./delete-record.js";
import { registerPortalSyncRoutes } from "./portal-sync.js";
import { spawnSync } from "node:child_process";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import ExcelJS from "exceljs";
import { validateWorkbookArchive } from "./excel-safety.js";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  pool,
  transaction,
  hashPassword,
  verifyPassword,
  tokenHash,
} from "./db.js";
import { schemas, envelope, userSchema, settingsSchema } from "./validation.js";
export const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY_HOPS === "1") app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: { "img-src": ["'self'", "https:", "data:"] },
    },
  }),
);
app.use(express.json({ limit: "1mb" }));
const fail = (status, message) => Object.assign(new Error(message), { status });
const allowed = new Set(Object.keys(schemas));
const shape = (r) => ({
  ...r,
  created_at: r.created_at,
  updated_at: r.updated_at,
});
async function event(c, entity, id, uid, body, kind = "history") {
  await c.query(
    "INSERT INTO events(entity,record_id,author_id,body,kind) VALUES($1,$2,$3,$4,$5)",
    [entity, id, uid, body, kind],
  );
}
const cookieOptions = {
  httpOnly: true,
  sameSite: "strict",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 8 * 60 * 60 * 1000,
};
app.use("/api", (req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.get("origin");
    if (origin && origin !== process.env.APP_ORIGIN)
      return next(fail(403, "Request origin is not allowed"));
    if (req.get("x-crm-request") !== "1")
      return next(fail(403, "Missing request verification"));
  }
  next();
});
app.get("/api/health", async (req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok", database: "PostgreSQL" });
});
app.post(
  "/api/auth/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  async (req, res) => {
    const { email, password } = req.body;
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      password.length > 200
    )
      throw fail(400, "Enter a valid email and password");
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE lower(email)=lower($1) AND active=true",
      [email],
    );
    const u = rows[0];
    if (!u || !verifyPassword(password, u.password_hash))
      throw fail(401, "Email or password is incorrect");
    const token = randomBytes(32).toString("hex");
    await pool.query("DELETE FROM sessions WHERE expires_at<now()");
    await pool.query(
      "INSERT INTO sessions VALUES($1,$2,now()+interval '8 hours')",
      [tokenHash(token), u.id],
    );
    res.cookie("crm_session", token, cookieOptions);
    res.json({ id: u.id, name: u.name, email: u.email, role: u.role });
  },
);
app.use("/api", async (req, res, next) => {
  try {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("crm_session="))
      ?.slice(12);
    if (!token) throw fail(401, "Please sign in");
    const { rows } = await pool.query(
      "SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now() AND u.active=true",
      [tokenHash(token)],
    );
    if (!rows[0]) throw fail(401, "Your session has expired");
    req.user = rows[0];
    next();
  } catch (e) {
    next(e);
  }
});
app.get("/api/auth/me", (req, res) => res.json(req.user));
app.post("/api/auth/logout", async (req, res) => {
  const token = (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("crm_session="))
    ?.slice(12);
  if (token)
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      tokenHash(token),
    ]);
  res.clearCookie("crm_session", { path: "/" });
  res.json({ ok: true });
});
app.use("/api", (req, res, next) => {
  if (req.method !== "GET" && req.user.role === "Viewer")
    return next(fail(403, "Viewers have read-only access"));
  next();
});
const admin = (req, res, next) =>
  req.user.role === "Admin"
    ? next()
    : next(fail(403, "Administrator access required"));
registerPortalSyncRoutes(app, admin);
registerDeletion(app, admin);
app.get("/api/users", async (req, res) =>
  res.json(
    (
      await pool.query(
        "SELECT id,name,email,role,active FROM users ORDER BY name",
      )
    ).rows,
  ),
);
app.post("/api/users", admin, async (req, res) => {
  const u = userSchema.parse(req.body);
  if (!u.password)
    throw fail(400, "A password of at least 12 characters is required");
  const id = randomUUID();
  await pool.query(
    "INSERT INTO users(id,name,email,role,active,password_hash) VALUES($1,$2,$3,$4,$5,$6)",
    [id, u.name, u.email, u.role, u.active, hashPassword(u.password)],
  );
  res.status(201).json({ id });
});
app.put("/api/users/:id", admin, async (req, res) => {
  const u = userSchema.parse(req.body);
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(927531)");
    const { rows } = await c.query(
      "SELECT * FROM users WHERE id=$1 FOR UPDATE",
      [req.params.id],
    );
    if (!rows[0]) throw fail(404, "Team member not found");
    if (req.user.id === req.params.id && (!u.active || u.role !== "Admin"))
      throw fail(409, "You cannot remove your own administrator access");
    if (
      rows[0].role === "Admin" &&
      rows[0].active &&
      (!u.active || u.role !== "Admin")
    ) {
      const count = await c.query(
        "SELECT count(*) FROM users WHERE role='Admin' AND active=true",
      );
      if (Number(count.rows[0].count) <= 1)
        throw fail(409, "At least one active administrator is required");
    }
    await c.query(
      "UPDATE users SET name=$2,email=$3,role=$4,active=$5,password_hash=COALESCE($6,password_hash) WHERE id=$1",
      [
        req.params.id,
        u.name,
        u.email,
        u.role,
        u.active,
        u.password ? hashPassword(u.password) : null,
      ],
    );
    if (u.password || !u.active)
      await c.query("DELETE FROM sessions WHERE user_id=$1", [req.params.id]);
  });
  res.json({ ok: true });
});
app.get("/api/settings", async (req, res) =>
  res.json(
    (await pool.query("SELECT data FROM settings WHERE id=1")).rows[0].data,
  ),
);
app.put("/api/settings", admin, async (req, res) => {
  const data = settingsSchema.parse(req.body);
  await pool.query("UPDATE settings SET data=$1 WHERE id=1", [data]);
  res.json(data);
});
app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "")
    .trim()
    .slice(0, 200);
  if (!q) return res.json([]);
  const out = [];
  for (const entity of allowed) {
    const { rows } = await pool.query(
      `SELECT id,data FROM ${entity} WHERE data->>'name' ILIKE $1 OR data->>'company' ILIKE $1 OR data->>'email' ILIKE $1 OR data->>'phone' ILIKE $1 ORDER BY created_at DESC LIMIT 8`,
      ["%" + q.replace(/[\\%_]/g, "\\$&") + "%"],
    );
    out.push(...rows.map((r) => ({ ...r, entity })));
  }
  res.json(out);
});
app.get("/api/dashboard", async (req, res) => {
  const days = Math.max(7, Math.min(365, Number(req.query.days) || 30));
  const {
    rows: [r],
  } = await pool.query(
    `SELECT (SELECT count(*) FROM leads) AS leads,(SELECT count(*) FROM customers WHERE data->>'status'='Active') AS customers,(SELECT count(*) FROM deals WHERE data->>'stage' NOT IN ('Won','Lost')) AS opportunities,(SELECT COALESCE(sum((data->>'value')::numeric),0) FROM deals WHERE data->>'stage' NOT IN ('Won','Lost')) AS value`,
  );
  const trends = await pool.query(
    "SELECT to_char(d,'YYYY-MM-DD') AS day,count(l.id)::int AS count FROM generate_series(current_date-($1::int-1),current_date,interval '1 day') d LEFT JOIN leads l ON l.created_at::date=d::date GROUP BY d ORDER BY d",
    [days],
  );
  const group = async (table, field) =>
    (
      await pool.query(
        `SELECT COALESCE(NULLIF(data->>'${field}',''),'Not specified') AS name,count(*)::int AS count FROM ${table} GROUP BY 1 ORDER BY 2 DESC`,
      )
    ).rows;
  res.json({
    ...r,
    trends: trends.rows,
    stages: await group("leads", "stage"),
    sources: await group("leads", "source"),
    industries: await group("customers", "industry"),
    recent: (
      await pool.query("SELECT * FROM leads ORDER BY created_at DESC LIMIT 5")
    ).rows,
    today: (
      await pool.query(
        "SELECT * FROM activities WHERE data->>'due_date'=to_char(current_date,'YYYY-MM-DD') AND data->>'status' NOT IN ('Completed','Cancelled') ORDER BY data->>'time' LIMIT 20",
      )
    ).rows,
    upcoming: (
      await pool.query(
        "SELECT * FROM activities WHERE data->>'due_date'>to_char(current_date,'YYYY-MM-DD') AND data->>'status' NOT IN ('Completed','Cancelled') ORDER BY data->>'due_date',data->>'time' LIMIT 8",
      )
    ).rows,
  });
});
app.param("entity", (req, res, next, entity) =>
  allowed.has(entity) ? next() : next(fail(404, "Unknown record type")),
);
function filters(q) {
  let parts = [],
    args = [];
  function add(sql, v) {
    args.push(v);
    parts.push(sql.replaceAll("?", () => `$${args.length}`));
  }
  if (q.q)
    add(
      "(data->>'name' ILIKE ? OR data->>'company' ILIKE ? OR data->>'email' ILIKE ? OR data->>'phone' ILIKE ?)",
      "%" + String(q.q).replace(/[\\%_]/g, "\\$&") + "%",
    ); // reuse one placeholder for all search fields
  if (q.stage) add("data->>'stage'=?", q.stage);
  if (q.status) add("data->>'status'=?", q.status);
  if (q.source) add("data->>'source'=?", q.source);
  if (q.industry) add("data->>'industry'=?", q.industry);
  if (q.assignee === "unassigned") parts.push("assignee_id IS NULL");
  else if (q.assignee) add("assignee_id=?", q.assignee);
  if (q.customer_id) add("customer_id=?", q.customer_id);
  if (q.lead_id) add("lead_id=?", q.lead_id);
  return { where: parts.length ? " WHERE " + parts.join(" AND ") : "", args };
}
function order(q) {
  const keys = [
    "name",
    "company",
    "email",
    "phone",
    "stage",
    "status",
    "source",
    "industry",
    "value",
    "probability",
    "type",
    "priority",
    "due_date",
    "close_date",
    "assignee",
  ];
  const key = keys.includes(q.sort) ? q.sort : null;
  return ` ORDER BY ${key ? (key === "assignee" ? "(SELECT name FROM users WHERE users.id=assignee_id)" : ["value", "probability"].includes(key) ? `(data->>'${key}')::numeric` : `data->>'${key}'`) : "created_at"} ${q.direction === "asc" ? "ASC" : "DESC"} NULLS LAST,id ASC`;
}
app.get("/api/:entity/export", async (req, res) => {
  const { entity } = req.params;
  const f = filters(req.query);
  if (req.query.ids) {
    const ids = String(req.query.ids).split(",");
    if (ids.length > 1000 || ids.some((id) => !/^[a-f0-9-]{36}$/i.test(id)))
      throw fail(400, "Invalid selected records");
    f.args.push(ids);
    f.where +=
      (f.where ? " AND " : " WHERE ") + `id=ANY($${f.args.length}::uuid[])`;
  }
  const { rows } = await pool.query(
    `SELECT * FROM ${entity}${f.where}${order(req.query)} LIMIT 50001`,
    f.args,
  );
  if (rows.length > 50000)
    throw fail(
      400,
      "Export is limited to 50,000 records. Narrow your filters.",
    );
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(entity);
  const keys = Object.keys(schemas[entity].shape);
  sheet.columns = [
    { header: "id", key: "id", width: 38 },
    ...keys.map((k) => ({ header: k, key: k, width: 24 })),
    { header: "assignee_id", key: "assignee_id", width: 38 },
    { header: "customer_id", key: "customer_id", width: 38 },
  ];
  for (const r of rows)
    sheet.addRow({
      id: r.id,
      ...r.data,
      assignee_id: r.assignee_id,
      customer_id: r.customer_id,
    });
  sheet.getRow(1).font = { bold: true };
  res.setHeader("Content-Disposition", `attachment; filename="${entity}.xlsx"`);
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  await workbook.xlsx.write(res);
  res.end();
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
app.post("/api/leads/import", upload.single("file"), async (req, res) => {
  if (
    !req.file ||
    !/\.(xlsx|xlsm)$/i.test(req.file.originalname.trim())
  ) {
    throw fail(400, "Choose an .xlsx or .xlsm workbook (maximum 5 MB)");
  }

  try {
    validateWorkbookArchive(req.file.buffer);
  } catch (e) {
    throw fail(400, e.message || "Invalid Excel archive");
  }

  let book = new ExcelJS.Workbook();

  try {
    await book.xlsx.load(req.file.buffer);
  } catch (primaryError) {
    const converted = spawnSync(
      "python3",
      ["server/excel-compat.py"],
      {
        input: req.file.buffer,
        timeout: 15000,
        maxBuffer: 12 * 1024 * 1024
      }
    );

    if (converted.error || converted.status !== 0) {
      console.error("ExcelJS import error:", primaryError.message);
      console.error("Compatibility error:",
        converted.stderr?.toString().slice(0, 1000));

      throw fail(
        400,
        "Excel format could not be processed. Please upload a valid, unprotected Excel workbook."
      );
    }

    try {
      validateWorkbookArchive(converted.stdout);
      book = new ExcelJS.Workbook();
      await book.xlsx.load(converted.stdout);
    } catch (e) {
      console.error("Normalized workbook error:", e.message);
      throw fail(400, "Excel workbook normalization failed");
    }
  }
  const sheet = book.worksheets[0];
  if (!sheet || sheet.rowCount > 10001)
    throw fail(400, "Import supports up to 10,000 rows");
  const headers = sheet
    .getRow(1)
    .values.slice(1)
    .map((x) => String(x).trim().toLowerCase().replaceAll(" ", "_"));
  if (!headers.includes("name"))
    throw fail(
      400,
      "Include a name column. Export leads for the supported template.",
    );
  const summary = { imported: 0, skipped: 0, errors: [] };
  await transaction(async (c) => {
    for (let i = 2; i <= sheet.rowCount; i++) {
      if (!sheet.getRow(i).hasValues) continue;
      await c.query("SAVEPOINT import_row");
      try {
        const raw = {};
        headers.forEach((h, j) => {
          if (h in schemas.leads.shape) {
            const value = sheet.getRow(i).getCell(j + 1).value;
            if (value && typeof value === "object" && !(value instanceof Date))
              throw fail(400, "Use plain cell values without formulas");
            raw[h] =
              value instanceof Date
                ? value.toISOString().slice(0, 10)
                : String(value ?? "");
          }
        });
        raw.stage = raw.stage || "New";
        if (raw.stage === "Converted")
          throw fail(
            400,
            "Import as New or Contacted, then convert within CRM",
          );
        const data = schemas.leads.parse(raw);
        await checkStage(c, data.stage);
        const id = randomUUID();
        await c.query("INSERT INTO leads(id,data) VALUES($1,$2)", [id, data]);
        await event(c, "leads", id, req.user.id, "Lead imported");
        summary.imported++;
      } catch (e) {
        await c.query("ROLLBACK TO SAVEPOINT import_row");
        summary.skipped++;
        if (summary.errors.length < 100)
          summary.errors.push({
            row: i,
            message:
              e.code === "23505"
                ? "Duplicate email"
                : e.issues
                    ?.map((x) => x.path.join(".") + ": " + x.message)
                    .join("; ") || e.message,
          });
      }
      await c.query("RELEASE SAVEPOINT import_row");
    }
  });
  res.json(summary);
});
app.get("/api/:entity", async (req, res) => {
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
  const limit = Math.min(
    100,
    Math.max(1, Math.floor(Number(req.query.limit) || 25)),
  );
  const f = filters(req.query);
  const count = await pool.query(
    `SELECT count(*) FROM ${req.params.entity}${f.where}`,
    f.args,
  );
  const { rows } = await pool.query(
    `SELECT * FROM ${req.params.entity}${f.where}${order(req.query)} LIMIT $${f.args.length + 1} OFFSET $${f.args.length + 2}`,
    [...f.args, limit, (page - 1) * limit],
  );
  res.json({
    rows: rows.map(shape),
    total: Number(count.rows[0].count),
    page,
    limit,
  });
});
app.get("/api/:entity/:id", async (req, res) => {
  const { entity, id } = req.params;
  const { rows } = await pool.query(`SELECT * FROM ${entity} WHERE id=$1`, [
    id,
  ]);
  if (!rows[0]) throw fail(404, "Record not found");
  const history = await pool.query(
    "SELECT e.*,u.name AS author FROM events e JOIN users u ON u.id=e.author_id WHERE entity=$1 AND record_id=$2 ORDER BY e.created_at DESC,e.id DESC",
    [entity, id],
  );
  const related = {};
  if (entity === "customers") {
    related.leads = (
      await pool.query("SELECT * FROM leads WHERE customer_id=$1", [id])
    ).rows;
    related.deals = (
      await pool.query("SELECT * FROM deals WHERE customer_id=$1", [id])
    ).rows;
  }
  if (entity === "customers" || entity === "leads")
    related.activities = (
      await pool.query(
        `SELECT * FROM activities WHERE ${entity === "leads" ? "lead_id" : "customer_id"}=$1 ORDER BY created_at DESC`,
        [id],
      )
    ).rows;
  res.json({ ...shape(rows[0]), events: history.rows, related });
});
async function checkStage(c, stage) {
  const { rows } = await c.query("SELECT data FROM settings WHERE id=1");
  if (!rows[0].data.lead_stages.includes(stage))
    throw fail(400, "Select a configured lead stage");
}
async function relations(c, entity, p) {
  if (p.assignee_id && !p.preserveAssignee) {
    const u = await c.query(
      "SELECT id FROM users WHERE id=$1 AND active=true",
      [p.assignee_id],
    );
    if (!u.rows.length) throw fail(400, "Select an active assignee");
  }
  if (entity === "activities" && p.lead_id) {
    const { rows } = await c.query(
      "SELECT customer_id FROM leads WHERE id=$1",
      [p.lead_id],
    );
    if (!rows.length) throw fail(400, "Linked lead does not exist");
    if (rows[0].customer_id) {
      if (p.customer_id && p.customer_id !== rows[0].customer_id)
        throw fail(400, "Select the customer linked to this converted lead");
      p.customer_id = rows[0].customer_id;
    }
  }
}
async function convert(c, lead, data, uid) {
  await c.query("SELECT pg_advisory_xact_lock(927532)");
  const match = await c.query(
    "SELECT * FROM customers WHERE (NULLIF($1,'') IS NOT NULL AND lower(data->>'contact_email')=lower($1)) OR (NULLIF($2,'') IS NOT NULL AND lower(data->>'company')=lower($2)) ORDER BY created_at LIMIT 1",
    [data.email, data.company],
  );
  let customer = match.rows[0];
  if (!customer) {
    const customerData = schemas.customers.parse({
      name: data.company || data.name,
      company: data.company,
      contact_name: data.name,
      designation: data.designation,
      contact_email: data.email,
      contact_phone: data.phone,
      email: data.email,
      phone: data.phone,
      alternate_phone: data.alternate_phone,
      website: data.website,
      gstin: data.gstin,
      industry: data.industry,
      address: data.address,
      source: data.source,
      notes: data.notes,
      status: "Active",
    });
    customer = (
      await c.query(
        "INSERT INTO customers(id,data,assignee_id) VALUES($1,$2,$3) RETURNING *",
        [randomUUID(), customerData, lead.assignee_id],
      )
    ).rows[0];
    await event(
      c,
      "customers",
      customer.id,
      uid,
      `Created from lead ${data.name}`,
    );
  } else {
    await event(
      c,
      "customers",
      customer.id,
      uid,
      `Linked converted lead ${data.name}; contact: ${data.email || data.phone || "not supplied"}`,
    );
  }
  const activities = await c.query(
    "UPDATE activities SET customer_id=$1,version=version+1,updated_at=now() WHERE lead_id=$2 RETURNING id",
    [customer.id, lead.id],
  );
  for (const a of activities.rows)
    await event(
      c,
      "activities",
      a.id,
      uid,
      "Customer linked through lead conversion",
    );
  return customer.id;
}
app.post("/api/:entity", async (req, res) => {
  const { entity } = req.params;
  const p = envelope.parse(req.body);
  const data = schemas[entity].parse(p.data);
  const r = await transaction(async (c) => {
    if (entity === "leads") {
      await checkStage(c, data.stage);
      if (data.stage === "Converted")
        throw fail(400, "Create the lead before converting it");
    }
    await relations(c, entity, p);
    const columns = ["id", "data", "assignee_id"];
    const values = [randomUUID(), data, p.assignee_id || null];
    if (["deals", "activities"].includes(entity)) {
      columns.push("customer_id");
      values.push(p.customer_id || null);
    }
    if (entity === "activities") {
      columns.push("lead_id");
      values.push(p.lead_id || null);
    }
    const { rows } = await c.query(
      `INSERT INTO ${entity}(${columns.join(",")}) VALUES(${values.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
      values,
    );
    await event(c, entity, rows[0].id, req.user.id, "Record created");
    return rows[0];
  });
  res.status(201).json(r);
});
app.put("/api/:entity/:id", async (req, res) => {
  const { entity, id } = req.params;
  const p = envelope.parse(req.body);
  const data = schemas[entity].parse(p.data);
  const r = await transaction(async (c) => {
    if (["leads", "customers"].includes(entity)) await c.query("SELECT pg_advisory_xact_lock(927532)");
    const { rows } = await c.query(
      `SELECT * FROM ${entity} WHERE id=$1 FOR UPDATE`,
      [id],
    );
    const old = rows[0];
    if (!old) throw fail(404, "Record not found");
    if (p.version !== old.version)
      throw fail(
        409,
        "This record changed. Close and reopen it before saving.",
      );
    const stateField = ["leads", "deals"].includes(entity) ? "stage" : "status";
    const stateChanged = data[stateField] !== old.data[stateField];
    if (entity === "leads") {
      await checkStage(c, data.stage);
      if (old.data.stage === "Converted" && data.stage !== "Converted")
        throw fail(409, "Converted leads cannot return to an earlier stage");
    }
    if (stateChanged && ["leads", "customers"].includes(entity) && !p.comment)
      throw fail(400, "Add a comment explaining the change");
    if (p.assignee_id === undefined) p.assignee_id = old.assignee_id;
    p.preserveAssignee = p.assignee_id === old.assignee_id;
    if (p.customer_id === undefined) p.customer_id = old.customer_id;
    if (p.lead_id === undefined) p.lead_id = old.lead_id;
    await relations(c, entity, p);
    let customer = old.customer_id;
    if (
      entity === "leads" &&
      old.data.stage !== "Converted" &&
      data.stage === "Converted"
    )
      customer = await convert(
        c,
        { ...old, assignee_id: p.assignee_id },
        data,
        req.user.id,
      );
    const sets = [
      "data=$2",
      "version=version+1",
      "updated_at=now()",
      "assignee_id=$3",
    ];
    const values = [id, data, p.assignee_id || null];
    if (entity !== "customers") {
      sets.push("customer_id=$4");
      values.push(entity === "leads" ? customer : p.customer_id || null);
    }
    if (entity === "activities") {
      sets.push("lead_id=$5");
      values.push(p.lead_id || null);
    }
    const updated = await c.query(
      `UPDATE ${entity} SET ${sets.join(",")} WHERE id=$1 RETURNING *`,
      values,
    );
    const changes = Object.keys(data)
      .filter((k) => JSON.stringify(data[k]) !== JSON.stringify(old.data[k]))
      .map((k) => `${k}: ${old.data[k] ?? "—"} → ${data[k]}`);
    for (const k of ["assignee_id", "customer_id", "lead_id"])
      if (k in old && old[k] !== updated.rows[0][k])
        changes.push(
          `${k}: ${old[k] || "Unassigned"} → ${updated.rows[0][k] || "Unassigned"}`,
        );
    await event(
      c,
      entity,
      id,
      req.user.id,
      (changes.join("\n") || "Record saved") +
        (p.comment ? "\nComment: " + p.comment : ""),
    );
    return updated.rows[0];
  });
  res.json(r);
});
app.post("/api/:entity/:id/comments", async (req, res) => {
  const body = String(req.body.body || "").trim();
  if (!body || body.length > 5000)
    throw fail(400, "Comments must be between 1 and 5,000 characters");
  const { entity, id } = req.params;
  const exists = await pool.query(`SELECT id FROM ${entity} WHERE id=$1`, [id]);
  if (!exists.rows.length) throw fail(404, "Record not found");
  await event(pool, entity, id, req.user.id, body, "comment");
  res.status(201).json({ ok: true });
});
app.use("/api", (req, res) =>
  res.status(404).json({ error: "API route not found" }),
);
app.use(express.static(fileURLToPath(new URL("../dist", import.meta.url))));
app.get("/{*path}", (req, res) =>
  res.sendFile(fileURLToPath(new URL("../dist/index.html", import.meta.url))),
);
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const validation = err.issues
    ?.map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
  const messages = {
    23505: "A record with that email already exists",
    23503: "The linked record does not exist",
    23502: "A required linked account is missing",
    "22P02": "Invalid record identifier",
    LIMIT_FILE_SIZE: "File is too large (maximum 5 MB)",
  };
  const message =
    validation ||
    messages[err.code] ||
    (err.status && err.message) ||
    "Unable to complete the request";
  const status = validation || messages[err.code] ? 400 : err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: message });
});
