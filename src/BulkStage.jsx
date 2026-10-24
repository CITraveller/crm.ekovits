import React, { useState } from "react";
export default function BulkStage({ rows, stages, api, Dialog, onDone }) {
  const [snapshot, setSnapshot] = useState(null),
    [stage, setStage] = useState(""),
    [comment, setComment] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const blocked = Boolean(
    snapshot?.some((r) => r.data.stage === "Converted") &&
    stage &&
    stage !== "Converted",
  );
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSnapshot(rows.map((r) => ({ ...r })));
          setStage("");
          setComment("");
          setError("");
        }}
      >
        Change stage
      </button>
      {snapshot && (
        <Dialog
          title="Change selected lead stages"
          onClose={() => {
            if (!busy) setSnapshot(null);
          }}
        >
          <form
            className="dialog-body"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy || blocked) return;
              setBusy(true);
              setError("");
              try {
                const result = await api("/leads/bulk-stage", {
                  method: "POST",
                  body: {
                    stage,
                    comment,
                    records: snapshot.map((r) => ({
                      id: r.id,
                      version: r.version,
                    })),
                  },
                });
                setSnapshot(null);
                onDone(result);
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              <strong>
                {snapshot.length} selected lead
                {snapshot.length === 1 ? "" : "s"}
              </strong>
              . All selected changes are saved together; if any lead cannot be
              updated, none are changed.
            </p>
            <p>
              {snapshot
                .slice(0, 8)
                .map((r) => r.data.name)
                .join(", ")}
              {snapshot.length > 8 ? "…" : ""}
            </p>
            <label className="field">
              <span>New stage</span>
              <select
                required
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                disabled={busy}
              >
                <option value="">Choose stage</option>
                {stages.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Reason for change</span>
              <textarea
                required
                maxLength={5000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={busy}
                placeholder="This comment will appear in each changed lead’s history."
              />
            </label>
            {stage === "Converted" && (
              <p>
                Each newly converted lead will create or link a customer account
                and link its activities. Customer accounts participate in Portal
                sync. Conversion cannot be reversed.
              </p>
            )}
            {blocked && (
              <div className="error" role="alert">
                Converted leads cannot move back to another stage. Cancel and
                remove them from your selection.
              </div>
            )}
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <div className="actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setSnapshot(null)}
              >
                Cancel
              </button>
              <button
                className="primary"
                type="submit"
                disabled={busy || blocked || !stage || !comment.trim()}
              >
                {busy ? "Updating…" : "Apply stage change"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
