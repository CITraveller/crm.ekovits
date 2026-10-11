import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { app } from "../server/app.js";
import { pool } from "../server/db.js";
test("PostgreSQL-backed CRM workflows and access controls", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port + "/api";
  const prefix = "QA-" + randomUUID();
  const ids = {
    leads: [],
    customers: [],
    deals: [],
    activities: [],
    users: [],
  };
  let cookie = "";
  async function request(
    path,
    { method = "GET", body, as = cookie, raw = false } = {},
  ) {
    const r = await fetch(base + path, {
      method,
      headers: {
        "x-crm-request": "1",
        ...(body instanceof FormData
          ? {}
          : { "content-type": "application/json" }),
        cookie: as,
      },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
    return {
      status: r.status,
      body: raw ? await r.arrayBuffer() : await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function create(entity, data, links = {}) {
    const r = await request("/" + entity, {
      method: "POST",
      body: { data, ...links },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ids[entity].push(r.body.id);
    return r.body;
  }
  try {
    await t.test("unauthenticated API calls are blocked", async () => {
      assert.equal((await request("/leads", { as: "" })).status, 401);
    });
    await t.test("admin sign-in and dashboard", async () => {
      const r = await request("/auth/login", {
        method: "POST",
        body: {
          email: process.env.ADMIN_EMAIL,
          password: process.env.ADMIN_PASSWORD,
        },
      });
      assert.equal(r.status, 200);
      cookie = r.cookie;
      assert.equal((await request("/dashboard")).status, 200);
      assert.equal((await request("/settings")).status, 200);
    });
    let lead, activity, customer;
    await t.test(
      "lead creation, validation, duplicate prevention and combined filtering",
      async () => {
        lead = await create("leads", {
          name: prefix + " Lead",
          company: prefix + " Co",
          email: prefix + "@example.com",
          phone: "1234567890",
          source: "Website",
          value: 150000,
        });
        assert.equal(
          (
            await request("/leads", {
              method: "POST",
              body: { data: { name: "", email: "bad" } },
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request("/leads", {
              method: "POST",
              body: { data: lead.data },
            })
          ).status,
          400,
        );
        const r = await request(
          "/leads?q=" +
            prefix +
            "&source=Website&stage=New&assignee=unassigned",
        );
        assert.equal(r.body.total, 1);
        activity = await create(
          "activities",
          { name: prefix + " Call", type: "Call", due_date: "2026-10-06" },
          { lead_id: lead.id },
        );
      },
    );
    await t.test(
      "stage changes require comments and edits reject stale versions",
      async () => {
        const body = {
          data: { ...lead.data, stage: "Contacted" },
          version: lead.version,
        };
        assert.equal(
          (await request("/leads/" + lead.id, { method: "PUT", body })).status,
          400,
        );
        const r = await request("/leads/" + lead.id, {
          method: "PUT",
          body: { ...body, comment: "Reached the buyer" },
        });
        assert.equal(r.status, 200);
        lead = r.body;
        assert.equal(
          (
            await request("/leads/" + lead.id, {
              method: "PUT",
              body: { ...body, comment: "Stale edit" },
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "conversion is atomic, links activities and cannot be reversed",
      async () => {
        const body = {
          data: { ...lead.data, stage: "Converted" },
          version: lead.version,
          comment: "Qualified customer",
        };
        const concurrent = await Promise.all([
          request("/leads/" + lead.id, { method: "PUT", body }),
          request("/leads/" + lead.id, { method: "PUT", body }),
        ]);
        assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
        lead = concurrent.find((r) => r.status === 200).body;
        ids.customers.push(lead.customer_id);
        customer = (await request("/customers/" + lead.customer_id)).body;
        assert.equal(customer.data.contact_email, lead.data.email);
        assert.equal(customer.related.activities[0].id, activity.id);
        const a = (await request("/activities/" + activity.id)).body;
        assert.equal(a.customer_id, customer.id);
        assert.equal(a.version, 2);
        assert.equal(
          (
            await request("/leads/" + lead.id, {
              method: "PUT",
              body: {
                data: { ...lead.data, stage: "New" },
                version: lead.version,
                comment: "Try reversal",
              },
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "matching customers are reused and direct conversion is allowed",
      async () => {
        const other = await create("leads", {
          name: prefix + " Second",
          company: lead.data.company,
          email: prefix + "second@example.com",
        });
        const r = await request("/leads/" + other.id, {
          method: "PUT",
          body: {
            data: { ...other.data, stage: "Converted" },
            version: other.version,
            comment: "Existing account",
          },
        });
        assert.equal(r.status, 200);
        assert.equal(r.body.customer_id, customer.id);
        const a = await create(
          "activities",
          { name: prefix + " Follow-up" },
          { lead_id: other.id },
        );
        assert.equal(a.customer_id, customer.id);
      },
    );
    await t.test("customer status history and saved comments", async () => {
      let r = await request("/customers/" + customer.id, {
        method: "PUT",
        body: {
          data: { ...customer.data, status: "On Hold" },
          version: customer.version,
          comment: "Awaiting contract",
        },
      });
      assert.equal(r.status, 200);
      assert.equal(
        (
          await request("/customers/" + customer.id + "/comments", {
            method: "POST",
            body: { body: "Contract received" },
          })
        ).status,
        201,
      );
      r = await request("/customers/" + customer.id);
      assert.ok(
        r.body.events.some(
          (e) => e.kind === "comment" && e.body === "Contract received",
        ),
      );
      assert.ok(r.body.events.some((e) => e.body.includes("Active → On Hold")));
    });
    await t.test(
      "opportunities require a customer and task completion persists",
      async () => {
        assert.equal(
          (
            await request("/deals", {
              method: "POST",
              body: { data: { name: "Missing account" } },
            })
          ).status,
          400,
        );
        await create(
          "deals",
          {
            name: prefix + " Deal",
            value: 50000,
            probability: 75,
            stage: "Proposal",
          },
          { customer_id: customer.id },
        );
        const a = (await request("/activities/" + activity.id)).body;
        const r = await request("/activities/" + a.id, {
          method: "PUT",
          body: {
            data: { ...a.data, status: "Completed" },
            version: a.version,
          },
        });
        assert.equal(r.status, 200);
        assert.equal(r.body.data.status, "Completed");
        assert.ok((await request("/search?q=" + prefix)).body.length >= 4);
      },
    );
    await t.test(
      "Excel exports contain selected records and safe cell values",
      async () => {
        const r = await request("/leads/export?ids=" + lead.id, { raw: true });
        assert.equal(r.status, 200);
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(Buffer.from(r.body));
        assert.equal(book.worksheets[0].rowCount, 2);
        assert.equal(book.worksheets[0].getCell("A2").value, lead.id);
      },
    );
    await t.test(
      "Excel import reports invalid and duplicate rows without losing valid rows",
      async () => {
        const book = new ExcelJS.Workbook();
        const sheet = book.addWorksheet("Leads");
        sheet.addRow(["name", "email", "source"]);
        sheet.addRow([
          prefix + " Imported",
          prefix + "import@example.com",
          "Event",
        ]);
        sheet.addRow([prefix + " Duplicate", lead.data.email, "Event"]);
        sheet.addRow([prefix + " Invalid", "invalid-email", "Event"]);
        const form = new FormData();
        form.append(
          "file",
          new Blob([await book.xlsx.writeBuffer()]),
          "leads.xlsx",
        );
        const r = await request("/leads/import", {
          method: "POST",
          body: form,
        });
        assert.equal(r.status, 200);
        assert.equal(r.body.imported, 1);
        assert.equal(r.body.skipped, 2);
        const imported = await request(
          "/leads?q=" + encodeURIComponent(prefix + " Imported"),
        );
        ids.leads.push(imported.body.rows[0].id);
      },
    );
    await t.test(
      "viewer is read-only and server blocks admin-only changes",
      async () => {
        for (const role of ["Viewer", "Sales Executive", "Sales Manager"]) {
          const email = prefix + role.replaceAll(" ", "") + "@example.com";
          const password = "Test-password-" + randomUUID();
          const u = await request("/users", {
            method: "POST",
            body: { name: prefix + role, email, role, password, active: true },
          });
          assert.equal(u.status, 201);
          ids.users.push(u.body.id);
          const login = await request("/auth/login", {
            method: "POST",
            body: { email, password },
          });
          assert.equal(login.status, 200);
          const as = login.cookie;
          assert.equal((await request("/leads", { as })).status, 200);
          assert.equal(
            (await request("/settings", { as, method: "PUT", body: {} }))
              .status,
            403,
          );
          assert.equal(
            (await request("/users", { as, method: "POST", body: {} })).status,
            403,
          );
          const r = await request("/leads", {
            as,
            method: "POST",
            body: { data: { name: prefix + " " + role } },
          });
          assert.equal(r.status, role === "Viewer" ? 403 : 201);
          if (r.status === 201) ids.leads.push(r.body.id);
          if (role === "Viewer")
            assert.equal(
              (
                await request("/leads/" + lead.id + "/comments", {
                  as,
                  method: "POST",
                  body: { body: "Forbidden" },
                })
              ).status,
              403,
            );
          await request("/auth/logout", { as, method: "POST" });
          assert.equal((await request("/leads", { as })).status, 401);
        }
      },
    );
    await t.test("administrators cannot remove their own access", async () => {
      const me = (await request("/auth/me")).body;
      const r = await request("/users/" + me.id, {
        method: "PUT",
        body: { name: me.name, email: me.email, role: "Viewer", active: true },
      });
      assert.equal(r.status, 409);
    });
    await t.test(
      "cross-origin writes and malformed identifiers are rejected",
      async () => {
        const r = await fetch(base + "/leads", {
          method: "POST",
          headers: {
            cookie,
            origin: "https://untrusted.example",
            "x-crm-request": "1",
            "content-type": "application/json",
          },
          body: JSON.stringify({ data: { name: "Blocked" } }),
        });
        assert.equal(r.status, 403);
        assert.equal((await request("/leads/not-a-uuid")).status, 400);
      },
    );
  } finally {
    for (const entity of ["activities", "deals", "leads", "customers"]) {
      await pool.query(
        "DELETE FROM events WHERE entity=$1 AND record_id=ANY($2::uuid[])",
        [entity, ids[entity]],
      );
      await pool.query(`DELETE FROM ${entity} WHERE id=ANY($1::uuid[])`, [
        ids[entity],
      ]);
    }
    await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids.users]);
    await request("/auth/logout", { method: "POST" }).catch(() => {});
    await new Promise((r) => server.close(r));
    await pool.end();
  }
});
