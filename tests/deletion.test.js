import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import pg from "pg";
import "dotenv/config";
test("CRM deletion permissions, links and sync exclusions", async (t) => {
  const schema = "delete_test_" + randomUUID().replaceAll("-", "");
  const url = new URL(process.env.DATABASE_URL);
  const owner = new pg.Pool({ connectionString: url.toString() });
  await owner.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  const { pool, tokenHash } = await import("../server/db.js");
  const { app } = await import("../server/app.js");
  const { importPortalCustomer } = await import("../server/portal-sync.js");
  let server;
  try {
    await pool.query(await fs.readFile("server/schema.sql", "utf8"));
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const cookies = {};
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
    const request = async (entity, id, body = {}, role = "Admin") => {
      const r = await fetch(base + "/" + entity + "/" + id, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-crm-request": "1",
          cookie: cookies[role] || "",
        },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    };
    const customer = randomUUID(),
      lead = randomUUID(),
      activity = randomUUID();
    await pool.query("INSERT INTO customers(id,data) VALUES($1,$2)", [
      customer,
      { name: "Delete Customer", status: "Active" },
    ]);
    await pool.query(
      "INSERT INTO leads(id,data,customer_id) VALUES($1,$2,$3)",
      [lead, { name: "Delete Lead", stage: "Converted" }, customer],
    );
    await pool.query(
      "INSERT INTO activities(id,data,lead_id,customer_id) VALUES($1,$2,$3,$4)",
      [activity, { name: "Keep activity" }, lead, customer],
    );
    const body = { version: 1, confirmName: "Delete Customer" };
    await t.test(
      "non-admins and unauthenticated callers cannot delete",
      async () => {
        for (const role of ["Sales Manager", "Sales Executive", "Viewer"])
          assert.equal(
            (await request("customers", customer, body, role)).status,
            403,
          );
        assert.equal(
          (await request("customers", customer, body, "Nobody")).status,
          401,
        );
      },
    );
    await t.test(
      "stale versions and incorrect confirmation are rejected",
      async () => {
        assert.equal(
          (await request("customers", customer, { ...body, version: 2 }))
            .status,
          409,
        );
        assert.equal(
          (
            await request("customers", customer, {
              ...body,
              confirmName: "Wrong",
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "opportunities prevent customer deletion without changing data",
      async () => {
        const deal = randomUUID();
        await pool.query(
          "INSERT INTO deals(id,data,customer_id) VALUES($1,$2,$3)",
          [deal, { name: "Keep deal" }, customer],
        );
        assert.equal((await request("customers", customer, body)).status, 409);
        assert.equal(
          (await pool.query("SELECT * FROM deleted_crm_records")).rowCount,
          0,
        );
        await pool.query("DELETE FROM deals WHERE id=$1", [deal]);
      },
    );
    await t.test(
      "deleting a converted customer preserves leads and activities; sync cannot recreate it",
      async () => {
        await pool.query(
          "UPDATE portal_customer_sync SET portal_customer_id='portal-delete' WHERE customer_id=$1",
          [customer],
        );
        assert.equal((await request("customers", customer, body)).status, 200);
        assert.equal(
          (await pool.query("SELECT * FROM customers WHERE id=$1", [customer]))
            .rowCount,
          0,
        );
        assert.equal(
          (
            await pool.query("SELECT customer_id FROM leads WHERE id=$1", [
              lead,
            ])
          ).rows[0].customer_id,
          null,
        );
        assert.equal(
          (
            await pool.query("SELECT customer_id FROM activities WHERE id=$1", [
              activity,
            ])
          ).rows[0].customer_id,
          null,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT * FROM portal_customer_sync WHERE customer_id=$1",
              [customer],
            )
          ).rowCount,
          0,
        );
        await importPortalCustomer({
          id: "portal-delete",
          crm_customer_id: customer,
          name: "Delete Customer",
          active: true,
          sync_modified_at: new Date().toISOString(),
        });
        await importPortalCustomer({
          id: "portal-delete",
          crm_customer_id: null,
          name: "Delete Customer",
          active: true,
          sync_modified_at: new Date().toISOString(),
        });
        assert.equal((await pool.query("SELECT * FROM customers")).rowCount, 0);
        assert.equal(
          (
            await pool.query(
              "SELECT snapshot FROM deleted_crm_records WHERE record_id=$1",
              [customer],
            )
          ).rows[0].snapshot.data.name,
          "Delete Customer",
        );
      },
    );
    await t.test(
      "lead deletion retains activities and stale delete is rejected",
      async () => {
        assert.equal(
          (
            await request("leads", lead, {
              version: 1,
              confirmName: "Delete Lead",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await request("leads", lead, {
              version: 2,
              confirmName: "Delete Lead",
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await pool.query("SELECT lead_id FROM activities WHERE id=$1", [
              activity,
            ])
          ).rows[0].lead_id,
          null,
        );
        assert.equal(
          (
            await request("leads", lead, {
              version: 2,
              confirmName: "Delete Lead",
            })
          ).status,
          404,
        );
      },
    );
    await t.test(
      "unwanted lead can be removed and its email reused",
      async () => {
        const id = randomUUID();
        await pool.query("INSERT INTO leads(id,data) VALUES($1,$2)", [
          id,
          { name: "Wrong lead", email: "wrong@example.test" },
        ]);
        assert.equal(
          (
            await request("leads", id, {
              version: 1,
              confirmName: "Wrong lead",
            })
          ).status,
          200,
        );
        await pool.query("INSERT INTO leads(id,data) VALUES($1,$2)", [
          randomUUID(),
          { name: "Correct lead", email: "wrong@example.test" },
        ]);
      },
    );
    await t.test('deleting a converted lead preserves its customer and sync queue',async()=>{
      const cid=randomUUID(),lid=randomUUID();
      await pool.query('INSERT INTO customers(id,data) VALUES($1,$2)',[cid,{name:'Retained customer',status:'Active'}]);
      await pool.query('INSERT INTO leads(id,data,customer_id) VALUES($1,$2,$3)',[lid,{name:'Remove converted lead',stage:'Converted'},cid]);
      assert.equal((await request('leads',lid,{version:1,confirmName:'Remove converted lead'})).status,200);
      assert.equal((await pool.query('SELECT * FROM customers WHERE id=$1',[cid])).rowCount,1);
      assert.equal((await pool.query('SELECT * FROM portal_customer_sync WHERE customer_id=$1',[cid])).rowCount,1);
    });
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await pool.end();
    await owner.query(`DROP SCHEMA ${schema} CASCADE`);
    await owner.end();
  }
});
