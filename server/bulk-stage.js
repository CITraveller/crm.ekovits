import { z } from "zod";
import { transaction } from "./db.js";
import { schemas } from "./validation.js";
const payload = z
  .object({
    stage: z.string().trim().min(1).max(200),
    comment: z
      .string()
      .trim()
      .min(1, "Add a comment explaining the change")
      .max(5000),
    records: z
      .array(
        z
          .object({ id: z.uuid(), version: z.number().int().positive() })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
const fail = (status, message) => Object.assign(new Error(message), { status });
export function registerBulkStage(app, { checkStage, convert, event }) {
  app.post("/api/leads/bulk-stage", async (req, res) => {
    const input = payload.parse(req.body);
    const ids = input.records.map((r) => r.id);
    if (new Set(ids).size !== ids.length)
      throw fail(400, "Select each lead only once.");
    const result = await transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(927532)");
      await checkStage(c, input.stage);
      const { rows } = await c.query(
        "SELECT * FROM leads WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [ids],
      );
      if (rows.length !== ids.length)
        throw fail(
          409,
          "One or more selected leads were deleted. Refresh the list and select them again.",
        );
      const versions = new Map(input.records.map((r) => [r.id, r.version]));
      for (const row of rows) {
        if (row.version !== versions.get(row.id))
          throw fail(
            409,
            "A selected lead changed. Refresh the list and select the leads again. No leads were updated.",
          );
        if (row.data.stage === "Converted" && input.stage !== "Converted")
          throw fail(
            409,
            "Converted leads cannot return to an earlier stage. Remove them from the selection. No leads were updated.",
          );
      }
      let updated = 0,
        unchanged = 0;
      for (const row of rows) {
        if (row.data.stage === input.stage) {
          unchanged++;
          continue;
        }
        const data = schemas.leads.parse({ ...row.data, stage: input.stage });
        const customer =
          input.stage === "Converted"
            ? await convert(c, row, data, req.user.id)
            : row.customer_id;
        await c.query(
          "UPDATE leads SET data=$2,customer_id=$3,version=version+1,updated_at=now() WHERE id=$1",
          [row.id, data, customer],
        );
        await event(
          c,
          "leads",
          row.id,
          req.user.id,
          `Bulk stage change: ${row.data.stage} → ${input.stage}\nComment: ${input.comment}`,
        );
        updated++;
      }
      return { updated, unchanged };
    });
    res.json(result);
  });
}
