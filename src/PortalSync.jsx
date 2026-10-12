import React, { useEffect, useState } from "react";
export default function PortalSync({ api }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () =>
      api("/integrations/portal")
        .then((d) => {
          if (active) {
            setData(d);
            setError("");
          }
        })
        .catch((e) => active && setError(e.message));
    load();
    const timer = setInterval(load, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Portal customer sync</h1>
          <p>
            Converted customer accounts are sent to Portal for quotes and
            invoices.
          </p>
        </div>
        <button
          disabled={busy || !data?.enabled}
          onClick={async () => {
            setBusy(true);
            try {
              await api("/integrations/portal/retry", { method: "POST" });
              setData(await api("/integrations/portal"));
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Scheduling…" : "Retry pending"}
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {data ? (
        <>
          <p>
            <strong>
              {data.enabled
                ? "Automatic sync enabled"
                : "Sync is not enabled on this server"}
            </strong>{" "}
            · {data.synced} synced · {data.pending} pending · {data.total} total
          </p>
          <p>
            Only customers linked to converted leads are included. Existing
            Portal matches require explicit linking. Complete missing billing
            and tax details in Portal before issuing documents.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Last synced</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.customer_id}>
                    <td>
                      {r.name}
                      <br />
                      <small>{r.customer_id}</small>
                    </td>
                    <td>{r.status}</td>
                    <td>
                      {r.synced_at
                        ? new Date(r.synced_at).toLocaleString()
                        : "—"}
                    </td>
                    <td>
                      {r.last_error ||
                        r.portal_customer_id ||
                        "Waiting for first delivery"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.rows.length && <p>No converted customer accounts yet.</p>}
          <p>Showing up to 500 accounts, with pending accounts first.</p>
        </>
      ) : (
        !error && <p>Loading sync status…</p>
      )}
    </section>
  );
}
