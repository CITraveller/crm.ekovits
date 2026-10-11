import { pool, hashPassword, transaction } from "./db.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
try {
  await transaction(async (c) => {
    await c.query(
      await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
    );
    const { rows } = await c.query("SELECT count(*) FROM users");
    if (Number(rows[0].count) === 0) {
      if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12)
        throw Error("Set ADMIN_PASSWORD to at least 12 characters");
      await c.query(
        "INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)",
        [
          randomUUID(),
          "Workspace Admin",
          process.env.ADMIN_EMAIL || "admin@crm.local",
          hashPassword(process.env.ADMIN_PASSWORD),
          "Admin",
        ],
      );
    }
  });
  console.log("Database schema ready.");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
