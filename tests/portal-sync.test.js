import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";
import express from "express";
import "dotenv/config";

test("CRM to Portal durable customer delivery", async (t) => {
  const prefix = "sync_test_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const original = process.env.DATABASE_URL;
  const url = new URL(original);
  url.searchParams.set("options", `-c search_path=${prefix}_crm`);
  process.env.DATABASE_URL = url.toString();
  const { pool, transaction } = await import("../server/db.js");
  const { sendNextCustomer } = await import("../server/portal-sync.js");
  url.searchParams.set("options", `-c search_path=${prefix}_portal`);
  const portal = new pg.Pool({ connectionString: url.toString() });
  const scratch = path.resolve(".local", prefix);
  let http;
  try {
    await admin.query(
      `CREATE SCHEMA ${prefix}_crm; CREATE SCHEMA ${prefix}_portal`,
    );
    await pool.query(await fs.readFile("server/schema.sql", "utf8"));
    await portal.query(
      await fs.readFile("tests/fixtures/portal/db/schema.sql", "utf8"),
    );
    await portal.query(
      await fs.readFile(
        "tests/fixtures/portal/db/migrations/202609160002_crm_customer_fields.sql",
        "utf8",
      ),
    );
    await portal.query(
      await fs.readFile(
        "deploy/portal-integration/202610120001_crm_sync.sql",
        "utf8",
      ),
    );
    await fs.cp("tests/fixtures/portal", scratch, { recursive: true });
    await fs.mkdir(path.join(scratch, "routes"), { recursive: true });
    await fs.copyFile(
      "deploy/portal-integration/crmIntegration.js",
      path.join(scratch, "routes/crmIntegration.js"),
    );
    const receiver = await import(
      pathToFileURL(path.join(scratch, "routes/crmIntegration.js"))
    );
    const portalTransaction = async (fn) => {
      const c = await portal.connect();
      try {
        await c.query("BEGIN");
        const out = await fn(c);
        await c.query("COMMIT");
        return out;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    };
    const receive = (body) => receiver.receiveCustomer(body, portalTransaction);
    process.env.CRM_SYNC_TOKEN = "a".repeat(64);
    const app = express();
    app.use(express.json());
    app.use(receiver.authorizeCrm);
    app.post("/", async (req, res, next) => {
      try {
        res.json(await receive(req.body));
      } catch (e) {
        next(e);
      }
    });
    app.use((e, req, res, next) =>
      res.status(e.status || 500).json({ error: e.message }),
    );
    http = app.listen(0, "127.0.0.1");
    await new Promise((r) => http.once("listening", r));
    const config = {
      enabled: true,
      url: `http://127.0.0.1:${http.address().port}/`,
      token: process.env.CRM_SYNC_TOKEN,
    };
    const id = randomUUID(),
      lead = randomUUID();
    const customer = {
      name: "Sync Example Ltd",
      status: "Active",
      contact_email: "billing@example.test",
      contact_name: "Example",
      address: "Billing address",
      gstin: "",
    };
    await t.test(
      "unconverted customers are excluded; conversion queues atomically",
      async () => {
        await pool.query("INSERT INTO customers(id,data) VALUES($1,$2)", [
          id,
          customer,
        ]);
        await pool.query("INSERT INTO leads(id,data) VALUES($1,$2)", [
          lead,
          { name: "Example", stage: "New" },
        ]);
        assert.equal(
          (await pool.query("SELECT * FROM portal_customer_sync")).rowCount,
          0,
        );
        await assert.rejects(
          transaction(async (c) => {
            await c.query(
              `UPDATE leads SET customer_id=$1,data=jsonb_set(data,'{stage}','"Converted"') WHERE id=$2`,
              [id, lead],
            );
            throw new Error("rollback");
          }),
        );
        assert.equal(
          (await pool.query("SELECT * FROM portal_customer_sync")).rowCount,
          0,
        );
        await pool.query(
          `UPDATE leads SET customer_id=$1,data=jsonb_set(data,'{stage}','"Converted"') WHERE id=$2`,
          [id, lead],
        );
        assert.equal(
          (await pool.query("SELECT * FROM portal_customer_sync")).rowCount,
          1,
        );
      },
    );
    await t.test("unauthorized deliveries are rejected", async () => {
      assert.equal(
        (
          await fetch(config.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          })
        ).status,
        401,
      );
    });
    await t.test("failed delivery remains pending then succeeds", async () => {
      await sendNextCustomer({ ...config, token: "b".repeat(64) });
      let row = (await pool.query("SELECT * FROM portal_customer_sync"))
        .rows[0];
      assert.equal(row.sent_revision, "0");
      assert.equal(row.attempts, 1);
      await pool.query("UPDATE portal_customer_sync SET next_attempt_at=now()");
      assert.equal(await sendNextCustomer(config), true);
      row = (await pool.query("SELECT * FROM portal_customer_sync")).rows[0];
      assert.equal(row.sent_revision, row.revision);
      assert.ok(row.portal_customer_id);
      assert.equal((await portal.query("SELECT * FROM customers")).rowCount, 1);
    });
    await t.test(
      "lost acknowledgement and repeated delivery create no duplicates",
      async () => {
        await pool.query(
          "UPDATE portal_customer_sync SET sent_revision=0,next_attempt_at=now()",
        );
        await sendNextCustomer(config, async (url, options) => {
          await fetch(url, options);
          throw new Error("connection lost");
        });
        await pool.query(
          "UPDATE portal_customer_sync SET next_attempt_at=now()",
        );
        await sendNextCustomer(config);
        assert.equal(
          (await portal.query("SELECT * FROM customers")).rowCount,
          1,
        );
      },
    );
    await t.test(
      "customer changes resync and preserve billing enrichment",
      async () => {
        await portal.query(`CREATE FUNCTION protect_documents() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Sync must not update existing documents'; END $$;
        CREATE TRIGGER protect_invoices BEFORE UPDATE ON invoices FOR EACH STATEMENT EXECUTE FUNCTION protect_documents();
        CREATE TRIGGER protect_quotes BEFORE UPDATE ON quotations FOR EACH STATEMENT EXECUTE FUNCTION protect_documents();`);
        await portal.query(
          "UPDATE customers SET state='Delhi',state_code='07',shipping_address='Portal shipping'",
        );
        await pool.query(
          "UPDATE customers SET data=$2,version=version+1 WHERE id=$1",
          [id, { ...customer, name: "Updated Ltd", address: "" }],
        );
        await Promise.all([sendNextCustomer(config), sendNextCustomer(config)]);
        const row = (await portal.query("SELECT * FROM customers")).rows[0];
        assert.equal(row.name, "Updated Ltd");
        assert.equal(row.state_code, "07");
        assert.equal(row.billing_address, "Billing address");
        assert.equal(row.shipping_address, "Portal shipping");
        await receive({ customerId: id, revision: "1", customer });
        assert.equal(
          (await portal.query("SELECT name FROM customers")).rows[0].name,
          "Updated Ltd",
        );
      },
    );
    await t.test(
      "existing matches require linking and bad fields are rejected",
      async () => {
        await assert.rejects(
          receive({
            customerId: randomUUID(),
            revision: "1",
            customer: { ...customer, name: "Updated Ltd" },
          }),
          (e) => e.status === 409,
        );
        await assert.rejects(
          receive({
            customerId: randomUUID(),
            revision: "1",
            customer: { ...customer, gstin: "bad" },
          }),
          (e) => e.status === 422,
        );
        assert.equal(
          (await portal.query("SELECT * FROM customers")).rowCount,
          1,
        );
      },
    );
    await t.test(
      "explicitly linked Portal customers update instead of duplicating",
      async () => {
        const linkedId = randomUUID();
        await portal.query(
          "INSERT INTO customers(id,name,billing_address,crm_customer_id) VALUES('existing','Linked account','Portal address',$1)",
          [linkedId],
        );
        const ack = await receive({
          customerId: linkedId,
          revision: "1",
          customer: {
            ...customer,
            name: "Linked account",
            contact_email: "different@example.test",
          },
        });
        assert.equal(ack.portalCustomerId, "existing");
        assert.equal(
          (await portal.query("SELECT * FROM customers")).rowCount,
          2,
        );
      },
    );
    await t.test(
      "existing conversions backfill without duplicating Portal accounts",
      async () => {
        await pool.query(
          "DELETE FROM portal_customer_sync WHERE customer_id=$1",
          [id],
        );
        await pool.query(await fs.readFile("server/schema.sql", "utf8"));
        assert.equal(
          (await pool.query("SELECT * FROM portal_customer_sync")).rowCount,
          1,
        );
        // A real worker restart reads the same persisted row. Identity remains
        // stable even if an older revision is redelivered after restore.
        await sendNextCustomer(config);
        assert.equal(
          (
            await portal.query(
              "SELECT * FROM customers WHERE crm_customer_id=$1",
              [id],
            )
          ).rowCount,
          1,
        );
      },
    );
    await t.test("migration backfill is repeatable", async () => {
      await pool.query(await fs.readFile("server/schema.sql", "utf8"));
      assert.equal(
        (await pool.query("SELECT * FROM portal_customer_sync")).rowCount,
        1,
      );
      assert.equal(await sendNextCustomer(config), false);
    });
    await t.test("CRM sync status requires an administrator", async () => {
      const { app: crmApp } = await import("../server/app.js");
      const s = crmApp.listen(0, "127.0.0.1");
      await new Promise((r) => s.once("listening", r));
      try {
        const endpoint = `http://127.0.0.1:${s.address().port}/api/integrations/portal`;
        assert.equal((await fetch(endpoint)).status, 401);
        const { tokenHash } = await import("../server/db.js");
        for (const role of ["Viewer", "Sales Manager", "Admin"]) {
          const user = randomUUID(),
            token = randomUUID();
          await pool.query(
            "INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)",
            [user, role, role + "@example.test", "unused", role],
          );
          await pool.query(
            "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
            [tokenHash(token), user],
          );
          const headers = {
            cookie: `crm_session=${token}`,
            "x-crm-request": "1",
          };
          assert.equal(
            (await fetch(endpoint, { headers })).status,
            role === "Admin" ? 200 : 403,
          );
          assert.equal(
            (await fetch(endpoint + "/retry", { method: "POST", headers }))
              .status,
            role === "Admin" ? 200 : 403,
          );
        }
      } finally {
        await new Promise((r) => s.close(r));
      }
    });
  } finally {
    if (http) await new Promise((r) => http.close(r));
    await pool.end();
    await portal.end();
    await admin.query(
      `DROP SCHEMA IF EXISTS ${prefix}_crm CASCADE; DROP SCHEMA IF EXISTS ${prefix}_portal CASCADE`,
    );
    await admin.end();
    process.env.DATABASE_URL = original;
    await fs.rm(scratch, { recursive: true, force: true });
  }
});
