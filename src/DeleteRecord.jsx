import React, { useState } from "react";
export default function DeleteRecord({ entity, record, api, onDeleted }) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const customer = entity === "customers";
  if (!open)
    return (
      <button
        type="button"
        className="delete-record-button"
        onClick={() => setOpen(true)}
      >
        Delete {customer ? "customer" : "lead"}
      </button>
    );
  return (
    <section
      className="delete-record-confirm"
      aria-label="Confirm record deletion"
    >
      <h3>Delete {record.data.name} from CRM?</h3>
      <p>
        {customer
          ? "The Portal account and its invoices remain. This customer will be excluded from Portal imports. Linked leads and activities will be kept without this customer link. Customers with opportunities cannot be deleted."
          : "The lead will be removed from CRM. Its customer account and activities will be kept; activities will no longer link to this lead."}
      </p>
      <label>
        Type the exact record name to confirm
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setName("");
            setError("");
          }}
        >
          Cancel
        </button>
        <button
          className="delete-record-button"
          type="button"
          disabled={busy || name !== record.data.name}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api("/" + entity + "/" + record.id, {
                method: "DELETE",
                body: { version: record.version, confirmName: name },
              });
              onDeleted();
            } catch (e) {
              setError(e.message);
              setBusy(false);
            }
          }}
        >
          {busy ? "Deleting…" : "Delete from CRM"}
        </button>
      </div>
    </section>
  );
}
