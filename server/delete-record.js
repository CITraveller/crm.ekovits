import { transaction } from "./db.js";
const fail = (status, message) => Object.assign(new Error(message), { status });
export function registerDeletion(app, admin) {
  app.delete("/api/:entity/:id", admin, async (req, res) => {
    const { entity, id } = req.params;
    if (!["leads", "customers"].includes(entity))
      throw fail(400, "Only leads and customers can be deleted here.");
    const { version, confirmName } = req.body || {};
    if (!Number.isInteger(version) || typeof confirmName !== "string")
      throw fail(400, "Confirm the record name before deleting.");
    await transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(72819412)");
      await c.query("SELECT pg_advisory_xact_lock(927532)");
      const record = (
        await c.query(`SELECT * FROM ${entity} WHERE id=$1 FOR UPDATE`, [id])
      ).rows[0];
      if (!record) throw fail(404, "Record already deleted or not found.");
      if (record.version !== version)
        throw fail(409, "This record changed. Reopen it before deleting.");
      if (confirmName !== record.data.name)
        throw fail(400, "The confirmation name does not match.");
      let portalId = null;
      if (entity === "customers") {
        if (
          (
            await c.query("SELECT 1 FROM deals WHERE customer_id=$1 LIMIT 1", [
              id,
            ])
          ).rowCount
        )
          throw fail(
            409,
            "This customer has linked opportunities. Reassign those opportunities before deleting the customer.",
          );
        portalId =
          (
            await c.query(
              "SELECT portal_customer_id FROM portal_customer_sync WHERE customer_id=$1",
              [id],
            )
          ).rows[0]?.portal_customer_id || null;
      }
      await c.query(
        "INSERT INTO deleted_crm_records(entity,record_id,snapshot,portal_customer_id,deleted_by) VALUES($1,$2,$3,$4,$5)",
        [entity, id, record, portalId, req.user.id],
      );
      if (entity === "customers") {
        await c.query(
          "UPDATE leads SET customer_id=NULL,version=version+1,updated_at=now() WHERE customer_id=$1",
          [id],
        );
        await c.query(
          "UPDATE activities SET customer_id=NULL,version=version+1,updated_at=now() WHERE customer_id=$1",
          [id],
        );
        if (portalId)
          await c.query(
            "DELETE FROM portal_import_conflicts WHERE portal_id=$1",
            [portalId],
          );
      } else {
        await c.query(
          "UPDATE activities SET lead_id=NULL,version=version+1,updated_at=now() WHERE lead_id=$1",
          [id],
        );
      }
      // History is retained alongside the audit snapshot; no cascading business deletion.
      await c.query(`DELETE FROM ${entity} WHERE id=$1`, [id]);
    });
    res.json({ deleted: true });
  });
}
