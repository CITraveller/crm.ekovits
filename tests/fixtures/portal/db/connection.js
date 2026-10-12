import pg from "pg";
import { env } from "../config/env.js";

export const pool = new pg.Pool(env.db);

export function databaseConfig(database = env.db.database) {
  return { ...env.db, database };
}

export async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}

export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
