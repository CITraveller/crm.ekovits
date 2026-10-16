import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";
import express from "express";
import "dotenv/config";

test("two-way customer sync with latest edit wins", async (t) => {
  const prefix = "sync_test_" + randomUUID().replaceAll("-", "");
  const original = process.env.DATABASE_URL,
    admin = new pg.Pool({ connectionString: original });
  const url = new URL(original);
  url.searchParams.set("options", `-c search_path=${prefix}_crm`);
  process.env.DATABASE_URL = url.toString();
  const { pool, transaction, tokenHash } = await import("../server/db.js");
  const { sendNextCustomer, pullPortalPage, importPortalCustomer } =
    await import("../server/portal-sync.js");
  url.searchParams.set("options", `-c search_path=${prefix}_portal`);
  const portal = new pg.Pool({ connectionString: url.toString() });
  const scratch = path.resolve(".local", prefix);
  let http;
  try {
    await admin.query(
      `CREATE SCHEMA ${prefix}_crm;CREATE SCHEMA ${prefix}_portal`,
    );
    const schema = await fs.readFile("server/schema.sql", "utf8");
    await pool.query(schema);
    await portal.query(
      await fs.readFile("tests/fixtures/portal/db/schema.sql", "utf8"),
    );
    await portal.query(
      await fs.readFile(
        "deploy/portal-integration/202610120001_crm_sync.sql",
        "utf8",
      ),
    );
    await portal.query(
      await fs.readFile(
        "deploy/portal-integration/202610120002_customer_sync_bidirectional.sql",
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
    const transact = async (fn) => {
      const c = await portal.connect();
      try {
        await c.query("BEGIN");
        const value = await fn(c);
        await c.query("COMMIT");
        return value;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    };
    process.env.CRM_SYNC_TOKEN = "a".repeat(64);
    const app = express();
    app.use(express.json());
    app.use(receiver.authorizeCrm);
    app.get("/", async (req, res, next) => {
      try {
        res.json(
          await receiver.listSyncCustomers(req.query.after || "", portal),
        );
      } catch (e) {
        next(e);
      }
    });
    app.post("/", async (req, res, next) => {
      try {
        res.json(await receiver.receiveCustomer(req.body, transact));
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
    const make = async (name, status = "Active", email = "") => {
      const id = randomUUID();
      await pool.query("INSERT INTO customers(id,data) VALUES($1,$2)", [
        id,
        { name, status, contact_email: email, address: "CRM address" },
      ]);
      return id;
    };
    const drain = async () => {
      for (let i = 0; i < 30 && (await sendNextCustomer(config)); i++);
    };
    let id, inactiveId;
    await t.test(
      "all manual accounts queue, including inactive; lead-only records excluded",
      async () => {
        id = await make("Active Example", "Active", "active@example.test");
        inactiveId = await make(
          "Inactive Example",
          "Inactive",
          "inactive@example.test",
        );
        await pool.query("INSERT INTO leads(id,data) VALUES($1,$2)", [
          randomUUID(),
          { name: "Lead only", stage: "New" },
        ]);
        assert.equal(
          (await pool.query("SELECT * FROM portal_customer_sync")).rowCount,
          2,
        );
        await assert.rejects(
          transaction(async (c) => {
            await c.query("INSERT INTO customers(id,data) VALUES($1,$2)", [
              randomUUID(),
              { name: "Rollback", status: "Active" },
            ]);
            throw Error("rollback");
          }),
        );
        assert.equal(
          (await pool.query("SELECT * FROM portal_customer_sync")).rowCount,
          2,
        );
      },
    );
    await t.test(
      "API rejects unauthenticated callers; failed deliveries retry",
      async () => {
        assert.equal((await fetch(config.url)).status, 401);
        await sendNextCustomer({ ...config, token: "b".repeat(64) });
        assert.equal(
          (
            await pool.query(
              "SELECT sum(attempts)::int AS n FROM portal_customer_sync",
            )
          ).rows[0].n,
          1,
        );
        await pool.query(
          "UPDATE portal_customer_sync SET next_attempt_at=now()",
        );
        await drain();
        assert.equal(
          (await portal.query("SELECT * FROM customers")).rowCount,
          2,
        );
        assert.equal(
          (
            await portal.query(
              "SELECT active FROM customers WHERE crm_customer_id=$1",
              [inactiveId],
            )
          ).rows[0].active,
          false,
        );
      },
    );
    await t.test(
      "new inactive Portal account imports into CRM and links back",
      async () => {
        await portal.query(
          "INSERT INTO customers(id,name,billing_address,email,active) VALUES('portal-new','Portal Origin','Portal address','portal@example.test',false)",
        );
        await pullPortalPage(config);
        await drain();
        const row = (
          await portal.query("SELECT * FROM customers WHERE id='portal-new'")
        ).rows[0];
        assert.ok(row.crm_customer_id);
        const local = (
          await pool.query("SELECT * FROM customers WHERE id=$1", [
            row.crm_customer_id,
          ])
        ).rows[0];
        assert.equal(local.data.status, "Inactive");
        assert.equal(local.data.address, "Portal address");
      },
    );
    await t.test(
      "latest Portal edit wins over pending CRM edit; invoice tables untouched",
      async () => {
        await portal.query(`CREATE FUNCTION protect_documents() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Sync must not update documents'; END $$;
    CREATE TRIGGER protect_invoices BEFORE UPDATE ON invoices FOR EACH STATEMENT EXECUTE FUNCTION protect_documents();
    CREATE TRIGGER protect_quotes BEFORE UPDATE ON quotations FOR EACH STATEMENT EXECUTE FUNCTION protect_documents();`);
        await pool.query(
          `UPDATE customers SET data=jsonb_set(data,'{name}','"Older CRM edit"') WHERE id=$1`,
          [id],
        );
        await portal.query(
          "UPDATE customers SET name='Newest Portal edit',active=false WHERE crm_customer_id=$1",
          [id],
        );
        await drain();
        const c = (
          await pool.query("SELECT data FROM customers WHERE id=$1", [id])
        ).rows[0].data;
        assert.equal(c.name, "Newest Portal edit");
        assert.equal(c.status, "Inactive");
      },
    );
    await t.test(
      "latest CRM edit wins and Portal-only fields remain intact",
      async () => {
        await portal.query(
          "UPDATE customers SET shipping_address='Keep shipping',state='Delhi',state_code='07' WHERE crm_customer_id=$1",
          [id],
        );
        await pool.query(
          `UPDATE customers SET data=data || $2::jsonb WHERE id=$1`,
          [
            id,
            {
              name: "Newest CRM edit",
              status: "Active",
              contact_email: "latest@example.test",
              email: "latest@example.test",
            },
          ],
        );
        await drain();
        const remote = (
          await portal.query(
            "SELECT * FROM customers WHERE crm_customer_id=$1",
            [id],
          )
        ).rows[0];
        assert.equal(remote.name, "Newest CRM edit");
        assert.equal(remote.active, true);
        assert.equal(remote.shipping_address, "Keep shipping");
        assert.equal(remote.state_code, "07");
      },
    );
    await t.test(
      "Portal edits flow back without any CRM pending change",
      async () => {
        await portal.query(
          "UPDATE customers SET contact_number='12345',notes='Edited in Portal' WHERE crm_customer_id=$1",
          [id],
        );
        await pullPortalPage(config);
        const c = (
          await pool.query("SELECT data FROM customers WHERE id=$1", [id])
        ).rows[0].data;
        assert.equal(c.contact_phone, "12345");
        assert.equal(c.notes, "Edited in Portal");
      },
    );
    await t.test(
      "repeated polling and acknowledgement loss neither duplicate nor loop",
      async () => {
        const before = (
          await pool.query("SELECT id,version FROM customers ORDER BY id")
        ).rows;
        await pullPortalPage(config);
        await drain();
        await pullPortalPage(config);
        assert.deepEqual(
          (await pool.query("SELECT id,version FROM customers ORDER BY id"))
            .rows,
          before,
        );
        await pool.query(
          `UPDATE customers SET data=jsonb_set(data,'{notes}','"Retry test"') WHERE id=$1`,
          [id],
        );
        await sendNextCustomer(config, async (u, o) => {
          await fetch(u, o);
          throw Error("lost response");
        });
        await pool.query(
          "UPDATE portal_customer_sync SET next_attempt_at=now()",
        );
        await drain();
        assert.equal(
          (await portal.query("SELECT * FROM customers")).rowCount,
          3,
        );
      },
    );
    await t.test(
      "unique company+email matches link automatically",
      async () => {
        const matchId = await make(
          "Existing Both",
          "Active",
          "both@example.test",
        );
        await portal.query(
          "INSERT INTO customers(id,name,billing_address,email) VALUES('existing-both','Existing Both','Existing Portal address','both@example.test')",
        );
        await drain();
        assert.equal(
          (
            await portal.query(
              "SELECT crm_customer_id FROM customers WHERE id='existing-both'",
            )
          ).rows[0].crm_customer_id,
          matchId,
        );
        assert.equal(
          (
            await portal.query(
              "SELECT * FROM customers WHERE name='Existing Both'",
            )
          ).rowCount,
          1,
        );
      },
    );
    await t.test(
      "ambiguous matches are flagged, not merged or duplicated",
      async () => {
        await make("Ambiguous Name");
        await portal.query(
          "INSERT INTO customers(id,name,billing_address) VALUES('ambiguous','Ambiguous Name','Existing')",
        );
        await drain();
        await pullPortalPage(config);
        assert.equal(
          (
            await portal.query(
              "SELECT * FROM customers WHERE name='Ambiguous Name'",
            )
          ).rowCount,
          1,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT * FROM portal_import_conflicts WHERE portal_id='ambiguous'",
            )
          ).rowCount,
          1,
        );
      },
    );
    await t.test(
      "migration repeat and stale deliveries preserve newest values",
      async () => {
        const before = (
          await pool.query(
            "SELECT count(*)::int AS n FROM portal_customer_sync",
          )
        ).rows[0].n;
        await pool.query(schema);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM portal_customer_sync",
            )
          ).rows[0].n,
          before,
        );
        const ack = await receiver.receiveCustomer(
          {
            customerId: id,
            revision: "1",
            modifiedAt: "2020-01-01T00:00:00.000Z",
            customer: { name: "Stale", status: "Inactive" },
          },
          transact,
        );
        assert.equal(ack.record.name, "Newest CRM edit");
      },
    );
    await t.test("sync status and retry are administrator-only", async () => {
      const { app: crmApp } = await import("../server/app.js");
      const s = crmApp.listen(0, "127.0.0.1");
      await new Promise((r) => s.once("listening", r));
      try {
        const endpoint = `http://127.0.0.1:${s.address().port}/api/integrations/portal`;
        assert.equal((await fetch(endpoint)).status, 401);
        for (const role of ["Viewer", "Sales Manager", "Admin"]) {
          const uid = randomUUID(),
            token = randomUUID();
          await pool.query(
            "INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)",
            [uid, role, role + "@example.test", "unused", role],
          );
          await pool.query(
            "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
            [tokenHash(token), uid],
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
    await t.test(
      "cleared shared fields and Portal reactivation propagate",
      async () => {
        await pool.query(
          "UPDATE customers SET data=data || $2::jsonb WHERE id=$1",
          [id, { address: "", notes: "" }],
        );
        await drain();
        assert.equal(
          (
            await portal.query(
              "SELECT billing_address FROM customers WHERE crm_customer_id=$1",
              [id],
            )
          ).rows[0].billing_address,
          "",
        );
        await portal.query(
          "UPDATE customers SET active=false WHERE crm_customer_id=$1",
          [id],
        );
        await pullPortalPage(config);
        assert.equal(
          (await pool.query("SELECT data FROM customers WHERE id=$1", [id]))
            .rows[0].data.status,
          "Inactive",
        );
        await portal.query(
          "UPDATE customers SET active=true WHERE crm_customer_id=$1",
          [id],
        );
        await pullPortalPage(config);
        assert.equal(
          (await pool.query("SELECT data FROM customers WHERE id=$1", [id]))
            .rows[0].data.status,
          "Active",
        );
      },
    );
    await t.test(
      "pagination imports accounts beyond the first 100, including inactive",
      async () => {
        await portal.query(
          "INSERT INTO customers(id,name,billing_address,email,active) SELECT 'page-'||i,'Page Account '||i,'Address','page'||i||'@example.test',false FROM generate_series(1,102) i",
        );
        let cursor = await pullPortalPage(config);
        assert.ok(cursor);
        cursor = await pullPortalPage(config, cursor);
        assert.equal(cursor, "");
        assert.equal(
          (
            await pool.query(
              "SELECT * FROM customers WHERE data->>'name' LIKE 'Page Account %' AND data->>'status'='Inactive'",
            )
          ).rowCount,
          102,
        );
      },
    );
  } finally {
    if (http) await new Promise((r) => http.close(r));
    await pool.end();
    await portal.end();
    await admin.query(
      `DROP SCHEMA IF EXISTS ${prefix}_crm CASCADE;DROP SCHEMA IF EXISTS ${prefix}_portal CASCADE`,
    );
    await admin.end();
    process.env.DATABASE_URL = original;
    await fs.rm(scratch, { recursive: true, force: true });
  }
});
