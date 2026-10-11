import "dotenv/config";
import pg from "pg";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
});
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const value = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === value.length && timingSafeEqual(value, expected);
}
export const tokenHash = (token) =>
  createHash("sha256").update(token).digest("hex");
export async function transaction(fn) {
  const c = await pool.connect();
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
}
