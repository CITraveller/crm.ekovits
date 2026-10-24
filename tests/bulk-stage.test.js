import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import pg from "pg";
import "dotenv/config";
test("atomic bulk lead stage changes", async (t) => {
  const schema = "bulk_test_" + randomUUID().replaceAll("-", ""),
    url = new URL(process.env.DATABASE_URL);
  const owner = new pg.Pool({ connectionString: url.toString() });
  await owner.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  const { pool, tokenHash } = await import("../server/db.js");
  const { app } = await import("../server/app.js");
  let server;
  try {
    await pool.query(await fs.readFile("server/schema.sql", "utf8"));
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const endpoint = `http://127.0.0.1:${server.address().port}/api/leads/bulk-stage`,
      cookies = {};
    for (const role of [
      "Admin",
      "Sales Manager",
      "Sales Executive",
      "Viewer",
    ]) {
      const id = randomUUID(),
        token = randomUUID();
      await pool.query(
        "INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)",
        [id, role, role + "@test.local", "unused", role],
      );
      await pool.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [tokenHash(token), id],
      );
      cookies[role] = "crm_session=" + token;
    }
    const ids = [randomUUID(), randomUUID()].sort();
    for (const [i, id] of ids.entries())
      await pool.query("INSERT INTO leads(id,data) VALUES($1,$2)", [
        id,
        {
          name: "Lead " + i,
          company: "Shared Company",
          stage: "New",
          email: "",
        },
      ]);
    const request = async (body, role = "Admin") => {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-crm-request": "1",
          cookie: cookies[role] || "",
        },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    };
    const records = () =>
      pool
        .query("SELECT id,version,data FROM leads ORDER BY id")
        .then((r) => r.rows);
    const input = async (stage) => ({
      stage,
      comment: "Bulk follow-up",
      records: (await records()).map(({ id, version }) => ({ id, version })),
    });
    await t.test("authentication and viewer access enforced", async () => {
      assert.equal(
        (await request(await input("Contacted"), "Nobody")).status,
        401,
      );
      assert.equal(
        (await request(await input("Contacted"), "Viewer")).status,
        403,
      );
    });
    await t.test(
      "empty selection, duplicates, oversized batches and empty comments rejected",
      async () => {
        const p = await input("Contacted");
        for (const body of [
          { ...p, records: [] },
          { ...p, records: [p.records[0], p.records[0]] },
          { ...p, records: Array(101).fill(p.records[0]) },
          { ...p, comment: "  " },
          { ...p, stage: "Invalid" },
        ])
          assert.equal((await request(body)).status, 400);
        assert.ok((await records()).every((r) => r.data.stage === "New"));
      },
    );
    await t.test(
      "sales executive can update stages with per-lead history",
      async () => {
        const r = await request(await input("Contacted"), "Sales Executive");
        assert.equal(r.status, 200);
        assert.equal(r.body.updated, 2);
        assert.ok(
          (await records()).every(
            (r) => r.version === 2 && r.data.stage === "Contacted",
          ),
        );
        assert.equal(
          (
            await pool.query(
              "SELECT * FROM events WHERE body LIKE '%Bulk follow-up%'",
            )
          ).rowCount,
          2,
        );
      },
    );
    await t.test(
      "stale and missing records reject the whole batch",
      async () => {
        const p = await input("New");
        p.records[1].version = 1;
        assert.equal((await request(p)).status, 409);
        p.records[1] = { id: randomUUID(), version: 1 };
        assert.equal((await request(p)).status, 409);
        assert.ok(
          (await records()).every(
            (r) => r.version === 2 && r.data.stage === "Contacted",
          ),
        );
      },
    );
    await t.test(
      "same-stage selection is a no-op and custom configured stages work",
      async () => {
        const r = await request(await input("Contacted"));
        assert.equal(r.body.updated, 0);
        assert.equal(r.body.unchanged, 2);
        await pool.query(
          `UPDATE settings SET data=jsonb_set(data,'{lead_stages}','["New","Contacted","Qualified","Converted"]') WHERE id=1`,
        );
        assert.equal(
          (await request(await input("Qualified"), "Sales Manager")).status,
          200,
        );
      },
    );
    await t.test(
      "a conversion failure rolls back customers, activity links and all stages",
      async () => {
        await pool.query(
          `UPDATE leads SET data=jsonb_set(data,'{email}','"invalid email"') WHERE id=$1`,
          [ids[1]],
        );
        await pool.query(
          "INSERT INTO activities(id,data,lead_id) VALUES($1,$2,$3)",
          [randomUUID(), { name: "Follow-up" }, ids[0]],
        );
        assert.equal((await request(await input("Converted"))).status, 400);
        assert.equal((await pool.query("SELECT * FROM customers")).rowCount, 0);
        assert.equal(
          (await pool.query("SELECT * FROM portal_customer_sync")).rowCount,
          0,
        );
        assert.ok((await records()).every((r) => r.data.stage === "Qualified"));
        assert.equal(
          (await pool.query("SELECT customer_id FROM activities")).rows[0]
            .customer_id,
          null,
        );
        await pool.query(
          `UPDATE leads SET data=jsonb_set(data,'{email}','""') WHERE id=$1`,
          [ids[1]],
        );
      },
    );
    await t.test(
      "bulk conversion reuses customers, links activities and queues sync",
      async () => {
        const r = await request(await input("Converted"));
        assert.equal(r.status, 200);
        assert.equal(r.body.updated, 2);
        const leads = (await pool.query("SELECT * FROM leads")).rows;
        assert.ok(
          leads.every((r) => r.data.stage === "Converted" && r.customer_id),
        );
        assert.equal(leads[0].customer_id, leads[1].customer_id);
        assert.equal((await pool.query("SELECT * FROM customers")).rowCount, 1);
        assert.equal(
          (await pool.query("SELECT * FROM portal_customer_sync")).rowCount,
          1,
        );
        assert.equal(
          (await pool.query("SELECT customer_id FROM activities")).rows[0]
            .customer_id,
          leads[0].customer_id,
        );
        assert.equal((await request(await input("New"))).status, 409);
        assert.equal(
          (await request(await input("Converted"))).body.unchanged,
          2,
        );
      },
    );
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await pool.end();
    await owner.query(`DROP SCHEMA ${schema} CASCADE`);
    await owner.end();
  }
});
