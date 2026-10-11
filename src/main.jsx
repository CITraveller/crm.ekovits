import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Users,
  Building2,
  BriefcaseBusiness,
  CalendarCheck,
  BarChart3,
  Settings,
  Search,
  Plus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  Download,
  Upload,
  List,
  Columns3,
  X,
  Maximize2,
  Minimize2,
  LogOut,
  Check,
  Command,
  SlidersHorizontal,
  MessageSquare,
  Clock,
  PanelLeft,
  CheckCircle2,
} from "lucide-react";
import "./style.css";
import { registerCRMTools } from "./webmcp.js";
const labels = {
  leads: "Leads",
  customers: "Customers",
  deals: "Opportunities",
  activities: "Activities",
};
const singular = {
  leads: "lead",
  customers: "customer",
  deals: "opportunity",
  activities: "activity",
};
const stateOptions = {
  leads: ["New", "Contacted", "Converted"],
  customers: ["Active", "Prospect", "On Hold", "Inactive"],
  deals: ["New", "Qualified", "Proposal", "Negotiation", "Won", "Lost"],
  activities: ["Pending", "In Progress", "Completed", "Cancelled"],
};
const roles = ["Admin", "Sales Manager", "Sales Executive", "Viewer"];
const money = (v) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(v) || 0);
const nice = (k) =>
  k.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
const date = (v) =>
  v
    ? new Date(v).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
const stateKey = (e) => (["leads", "deals"].includes(e) ? "stage" : "status");
const initials = (n) =>
  n
    ?.split(" ")
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase() || "?";
async function api(path, options = {}) {
  const r = await fetch("/api" + path, {
    ...options,
    headers: {
      "x-crm-request": "1",
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    body:
      options.body === undefined
        ? undefined
        : options.body instanceof FormData
          ? options.body
          : JSON.stringify(options.body),
  });
  if (!r.ok) {
    const error = await r.json().catch(() => ({ error: "Request failed" }));
    throw Error(error.error || "Request failed");
  }
  return r.json();
}
function Badge({ children }) {
  return (
    <span
      className={
        "badge b-" + String(children).toLowerCase().replaceAll(" ", "-")
      }
    >
      {children || "—"}
    </span>
  );
}
function Avatar({ name }) {
  return <span className="avatar">{initials(name)}</span>;
}
function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Empty({
  text = "No records yet",
  detail = "Create your first record to get started.",
}) {
  return (
    <div className="empty">
      <Columns3 size={30} />
      <h3>{text}</h3>
      <p>{detail}</p>
    </div>
  );
}
function Dialog({ title, children, onClose, wide = false }) {
  const ref = useRef();
  const [full, setFull] = useState(false);
  useEffect(() => {
    const el = ref.current;
    el.showModal();
    const close = (e) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener("cancel", close);
    return () => {
      el.removeEventListener("cancel", close);
      el.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={(wide ? "wide " : "") + (full ? "expanded" : "")}
    >
      <header className="dialog-head">
        <h2>{title}</h2>
        <div>
          <button
            className="icon"
            aria-label={full ? "Restore dialog" : "Expand dialog"}
            onClick={() => setFull(!full)}
          >
            {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button className="icon" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
      </header>
      {children}
    </dialog>
  );
}
function App() {
  const [user, setUser] = useState(null),
    [loading, setLoading] = useState(true),
    [view, setView] = useState(location.hash.slice(1) || "dashboard"),
    [users, setUsers] = useState([]),
    [settings, setSettings] = useState({
      company_name: "Orbit CRM",
      lead_stages: stateOptions.leads,
    }),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [modal, setModal] = useState(null),
    [revision, setRevision] = useState(0),
    [search, setSearch] = useState(""),
    [results, setResults] = useState([]),
    [mobile, setMobile] = useState(false);
  const notify = (m) => {
    setToast(m);
    setTimeout(() => setToast(""), 5000);
  };
  const refresh = () => setRevision((v) => v + 1);
  const writable = user && user.role !== "Viewer";
  useEffect(() => {
    api("/auth/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoading(false));
    const h = () => setView(location.hash.slice(1) || "dashboard");
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  useEffect(() => {
    if (user)
      Promise.all([api("/users"), api("/settings")])
        .then(([u, s]) => {
          setUsers(u);
          setSettings(s);
        })
        .catch((e) => setError(e.message));
  }, [user, revision]);
  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      if (search.trim())
        api("/search?q=" + encodeURIComponent(search))
          .then((r) => active && setResults(r))
          .catch((e) => setError(e.message));
      else setResults([]);
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [search]);
  const go = (v) => {
    location.hash = v;
    setMobile(false);
  };
  const open = (entity, id) => {
    setModal({ type: "detail", entity, id });
    setSearch("");
  };
  useEffect(() => {
    if (user) return registerCRMTools(api, open);
  }, [user]);
  if (loading) return <div className="loading">Opening your workspace…</div>;
  if (!user) return <Login onLogin={setUser} />;
  const nav = [
    ["dashboard", "Overview", LayoutDashboard],
    ["leads", "Leads", Users],
    ["customers", "Customers", Building2],
    ["deals", "Opportunities", BriefcaseBusiness],
    ["activities", "Activities", CalendarCheck],
    ["reports", "Reports", BarChart3],
  ];
  return (
    <div className="app">
      <aside className={mobile ? "sidebar show" : "sidebar"}>
        <a className="brand" href="#dashboard">
          <span className="brandmark">
            <span />
            <span />
          </span>
          orbit<span className="brand-crm">CRM</span>
        </a>
        <button className="workspace" onClick={() => go("dashboard")}>
          <span className="workspace-logo">
            {settings.logo_url ? (
              <img src={settings.logo_url} alt="Company logo" />
            ) : (
              "O"
            )}
          </span>
          <span>
            <strong>{settings.company_name}</strong>
            <small>Sales workspace</small>
          </span>
          <ChevronDown size={16} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => go(id)}
            >
              <Icon size={19} />
              {label}
              {id === "leads" && <span className="nav-shortcut">L</span>}
            </button>
          ))}
        </nav>
        {user.role === "Admin" && (
          <>
            <div className="nav-label admin-label">ADMINISTRATION</div>
            <nav>
              <button
                className={view === "team" ? "active" : ""}
                onClick={() => go("team")}
              >
                <Users size={19} />
                Team members
              </button>
              <button
                className={view === "settings" ? "active" : ""}
                onClick={() => go("settings")}
              >
                <Settings size={19} />
                Settings
              </button>
            </nav>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="workspace-note">
            <span className="online-dot" /> Connected workspace
            <small>Local PostgreSQL</small>
          </div>
          <div className="profile">
            <Avatar name={user.name} />
            <span>
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </span>
            <button
              className="icon"
              title="Sign out"
              onClick={async () => {
                await api("/auth/logout", { method: "POST" });
                setUser(null);
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button
            className="icon mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMobile(!mobile)}
          >
            <PanelLeft size={20} />
          </button>
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            <strong>{labels[view] || nice(view)}</strong>
          </div>
          <div className="global-search">
            <Search size={17} />
            <input
              aria-label="Search all records"
              placeholder="Search your workspace…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Command size={14} />
            {search && (
              <div className="search-results">
                {results.length ? (
                  results.map((r) => (
                    <button key={r.id} onClick={() => open(r.entity, r.id)}>
                      <span>
                        {r.data.name}
                        <small>
                          {labels[r.entity]} · {r.data.company || r.data.email}
                        </small>
                      </span>
                      <ArrowUpRight size={15} />
                    </button>
                  ))
                ) : (
                  <p>No matching records</p>
                )}
              </div>
            )}
          </div>
          <Avatar name={user.name} />
        </header>
        <main className="content">
          {error && (
            <div className="error" role="alert">
              {error}
              <button className="icon" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {view === "dashboard" ? (
            <Dashboard
              revision={revision}
              open={open}
              create={() => setModal({ type: "form", entity: "leads" })}
              writable={writable}
            />
          ) : labels[view] ? (
            <Records
              key={view}
              entity={view}
              users={users}
              stages={settings.lead_stages}
              revision={revision}
              open={open}
              writable={writable}
              create={() => setModal({ type: "form", entity: view })}
              notify={notify}
            />
          ) : view === "reports" ? (
            <Reports revision={revision} />
          ) : view === "team" && user.role === "Admin" ? (
            <Team users={users} refresh={refresh} notify={notify} />
          ) : view === "settings" && user.role === "Admin" ? (
            <SettingsPage value={settings} refresh={refresh} notify={notify} />
          ) : (
            <Empty
              text="Page unavailable"
              detail="Choose a workspace section from the navigation."
            />
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {modal?.type === "form" && (
        <RecordForm
          entity={modal.entity}
          record={modal.record}
          users={users}
          stages={settings.lead_stages}
          onClose={() => setModal(null)}
          onSave={(r) => {
            refresh();
            notify("Record saved");
            setModal({ type: "detail", entity: modal.entity, id: r.id });
          }}
        />
      )}
      {modal?.type === "detail" && (
        <Detail
          key={modal.entity + modal.id}
          entity={modal.entity}
          id={modal.id}
          users={users}
          writable={writable}
          stages={settings.lead_stages}
          onClose={() => setModal(null)}
          onEdit={(r) =>
            setModal({ type: "form", entity: modal.entity, record: r })
          }
          open={open}
          refresh={refresh}
          notify={notify}
        />
      )}
    </div>
  );
}
function Login({ onLogin }) {
  const [email, setEmail] = useState("admin@crm.local"),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <section className="login-intro">
        <span className="eyebrow">ORBIT / CRM</span>
        <h1>
          A clear view.
          <br />A closer connection.
        </h1>
        <p>
          Your leads, customers, and next steps.
          <br />
          One shared sales workspace.
        </p>
        <div className="login-stages">
          <span>New</span>
          <i />
          <span>Contacted</span>
          <i />
          <span>Converted</span>
        </div>
      </section>
      <form
        className="login-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            onLogin(
              await api("/auth/login", {
                method: "POST",
                body: { email, password },
              }),
            );
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="eyebrow">WELCOME BACK</span>
        <h2>Sign in to your workspace</h2>
        <p>Use your team account to continue.</p>
        {error && <div className="error">{error}</div>}
        <Field label="Email address">
          <input
            type="email"
            required
            value={email}
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            required
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button className="primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <small>Account access is managed by your administrator.</small>
      </form>
    </div>
  );
}
function Dashboard({ revision, open, create, writable }) {
  const [data, setData] = useState(null),
    [days, setDays] = useState(30),
    [error, setError] = useState("");
  useEffect(() => {
    api("/dashboard?days=" + days)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [days, revision]);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">YOUR SALES WORKSPACE</div>
          <h1>Overview</h1>
          <p>Every relationship. Every next step.</p>
        </div>
        <div className="actions">
          <span className="date-label">{date(new Date())}</span>
          {writable && (
            <button className="primary" onClick={create}>
              <Plus size={18} />
              Create lead
            </button>
          )}
        </div>
      </div>
      {error ? (
        <div className="error">{error}</div>
      ) : !data ? (
        <div className="loading">Loading overview…</div>
      ) : (
        <>
          <div className="stats">
            {[
              ["Total leads", data.leads, Users, "All captured leads"],
              [
                "Active customers",
                data.customers,
                Building2,
                "Relationships in progress",
              ],
              [
                "Open opportunities",
                data.opportunities,
                BriefcaseBusiness,
                "Across your sales pipeline",
              ],
              [
                "Pipeline value",
                money(data.value),
                BarChart3,
                "Estimated open opportunity value",
              ],
            ].map(([title, value, Icon, sub]) => (
              <article className="stat" key={title}>
                <div>
                  {title}
                  <Icon size={19} />
                </div>
                <strong>{value}</strong>
                <small>{sub}</small>
              </article>
            ))}
          </div>
          <div className="dashboard-grid">
            <section className="panel trend">
              <div className="panel-head">
                <div>
                  <h2>Lead momentum</h2>
                  <p>New leads over time</p>
                </div>
                <select
                  aria-label="Trend period"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  <option value={7}>Last 7 days</option>
                  <option value={30}>Last 30 days</option>
                  <option value={90}>Last 90 days</option>
                  <option value={365}>Last year</option>
                </select>
              </div>
              <Trend values={data.trends} />
            </section>
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Lead sources</h2>
                  <p>Where your relationships begin</p>
                </div>
              </div>
              <Distribution items={data.sources} />
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Recent leads</h2>
                <a href="#leads">
                  View all leads <ArrowUpRight size={15} />
                </a>
              </div>
              {data.recent.length ? (
                <div className="recent-list">
                  {data.recent.map((r) => (
                    <button key={r.id} onClick={() => open("leads", r.id)}>
                      <Avatar name={r.data.name} />
                      <span>
                        <strong>{r.data.name}</strong>
                        <small>
                          {r.data.company || r.data.email || "No company added"}
                        </small>
                      </span>
                      <Badge>{r.data.stage}</Badge>
                    </button>
                  ))}
                </div>
              ) : (
                <Empty
                  text="Your pipeline starts here"
                  detail="Create or import leads to begin tracking relationships."
                />
              )}
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>
                  Today’s tasks{" "}
                  <span className="count">{data.today.length}</span>
                </h2>
                <a href="#activities">
                  View all <ArrowUpRight size={15} />
                </a>
              </div>
              <ActivityList
                rows={data.today}
                open={open}
                empty="You’re all caught up for today"
              />
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Pipeline at a glance</h2>
              </div>
              <Distribution items={data.stages} />
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Coming up</h2>
                <CalendarCheck size={18} />
              </div>
              <ActivityList
                rows={data.upcoming}
                open={open}
                empty="No upcoming activities"
              />
            </section>
          </div>
        </>
      )}
    </>
  );
}
function Trend({ values }) {
  const max = Math.max(1, ...values.map((v) => v.count));
  const points = values
    .map(
      (v, i) =>
        `${40 + (i / (values.length - 1)) * 620},${165 - (v.count / max) * 135}`,
    )
    .join(" ");
  return (
    <div className="chart">
      <svg
        viewBox="0 0 700 210"
        role="img"
        aria-label={`Lead trend: ${values.reduce((a, v) => a + v.count, 0)} leads in selected period`}
      >
        <defs>
          <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#3169e8" stopOpacity=".2" />
            <stop offset="100%" stopColor="#3169e8" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((n) => (
          <g key={n}>
            <line
              x1="40"
              y1={165 - n * 135}
              x2="665"
              y2={165 - n * 135}
              stroke="#e9edf3"
              strokeDasharray="4 4"
            />
            <text x="15" y={170 - n * 135}>
              {Math.round(max * n)}
            </text>
          </g>
        ))}
        <polygon points={`40,165 ${points} 660,165`} fill="url(#area)" />
        <polyline
          points={points}
          fill="none"
          stroke="#3269e7"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <text x="40" y="200">
          {date(values[0]?.day)}
        </text>
        <text x="660" y="200" textAnchor="end">
          {date(values.at(-1)?.day)}
        </text>
      </svg>
    </div>
  );
}
function Distribution({ items }) {
  const total = items.reduce((n, r) => n + r.count, 0);
  return items.length ? (
    <div className="distribution">
      {items.map((r, i) => (
        <div key={r.name}>
          <div>
            <span>
              <i
                style={{
                  background: [
                    "#3468e5",
                    "#799cf0",
                    "#9e83df",
                    "#42a9a0",
                    "#efb35c",
                  ][i % 5],
                }}
              />
              {r.name}
            </span>
            <strong>
              {r.count}
              <small>{Math.round((r.count / total) * 100)}%</small>
            </strong>
          </div>
          <div className="bar">
            <span
              style={{
                width: (r.count / total) * 100 + "%",
                background: [
                  "#3468e5",
                  "#799cf0",
                  "#9e83df",
                  "#42a9a0",
                  "#efb35c",
                ][i % 5],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  ) : (
    <Empty text="No data yet" detail="Your records will appear here." />
  );
}
function ActivityList({ rows, open, empty }) {
  return rows.length ? (
    <div className="activity-list">
      {rows.map((r) => (
        <button key={r.id} onClick={() => open("activities", r.id)}>
          <span className="task-icon">
            <Check size={15} />
          </span>
          <span>
            <strong>{r.data.name}</strong>
            <small>
              {r.data.type} · {date(r.data.due_date)} {r.data.time}
            </small>
          </span>
          <Badge>{r.data.priority}</Badge>
        </button>
      ))}
    </div>
  ) : (
    <Empty text={empty} detail="Calls, meetings and follow-ups appear here." />
  );
}
const defaultColumns = {
  leads: ["name", "company", "stage", "source", "value", "assignee"],
  customers: ["name", "industry", "status", "email", "assignee"],
  deals: ["name", "stage", "value", "probability", "close_date", "assignee"],
  activities: ["name", "type", "status", "due_date", "priority", "assignee"],
};
function Records({
  entity,
  users,
  stages,
  revision,
  open,
  writable,
  create,
  notify,
}) {
  const [rows, setRows] = useState([]),
    [total, setTotal] = useState(0),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [q, setQ] = useState(""),
    [state, setState] = useState(""),
    [source, setSource] = useState(""),
    [industry, setIndustry] = useState(""),
    [assignee, setAssignee] = useState(""),
    [sort, setSort] = useState("created_at"),
    [direction, setDirection] = useState("desc"),
    [page, setPage] = useState(1),
    [limit, setLimit] = useState(25),
    [board, setBoard] = useState(false),
    [selected, setSelected] = useState([]),
    [cols, setCols] = useState(() => {
      try {
        return (
          JSON.parse(localStorage.getItem("columns-" + entity)) ||
          defaultColumns[entity]
        );
      } catch {
        return defaultColumns[entity];
      }
    }),
    [importResult, setImportResult] = useState(null),
    [localRev, setLocalRev] = useState(0);
  const file = useRef();
  const states = entity === "leads" ? stages : stateOptions[entity];
  const query = new URLSearchParams({
    q,
    [stateKey(entity)]: state,
    source,
    industry,
    assignee,
    sort,
    direction,
    page,
    limit,
  }).toString();
  useEffect(() => {
    let active = true;
    setBusy(true);
    const t = setTimeout(
      () =>
        api("/" + entity + "?" + query)
          .then((r) => {
            if (active) {
              setRows(r.rows);
              setTotal(r.total);
              setError("");
              setSelected([]);
            }
          })
          .catch((e) => active && setError(e.message))
          .finally(() => active && setBusy(false)),
      180,
    );
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query, revision, localRev]);
  function filter(set, v) {
    set(v);
    setPage(1);
  }
  const allColumns = [
    ...new Set([
      ...defaultColumns[entity],
      "email",
      "phone",
      "source",
      "industry",
      "created_at",
    ]),
  ].filter(
    (k) =>
      !(
        ["deals", "activities"].includes(entity) &&
        ["email", "phone", "industry", "source"].includes(k)
      ),
  );
  function column(k) {
    const next = cols.includes(k) ? cols.filter((c) => c !== k) : [...cols, k];
    if (next.length) {
      setCols(next);
      localStorage.setItem("columns-" + entity, JSON.stringify(next));
    }
  }
  async function download() {
    try {
      const r = await fetch(
        "/api/" +
          entity +
          "/export?" +
          query +
          (selected.length ? "&ids=" + selected.join(",") : ""),
      );
      if (!r.ok) throw Error((await r.json()).error);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = entity + ".xlsx";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("Export downloaded");
    } catch (e) {
      setError(e.message);
    }
  }
  async function importFile(f) {
    if (!f) return;
    setBusy(true);
    const body = new FormData();
    body.append("file", f);
    try {
      setImportResult(await api("/leads/import", { method: "POST", body }));
      setLocalRev((v) => v + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      file.current.value = "";
    }
  }
  const cell = (r, k) =>
    k === "name" ? (
      <>
        <span className="record-key">
          {entity.slice(0, 3).toUpperCase()}-{r.id.slice(0, 5).toUpperCase()}
        </span>
        <strong>{r.data.name}</strong>
      </>
    ) : k === "assignee" ? (
      <span className="assignee">
        {r.assignee_id && (
          <Avatar name={users.find((u) => u.id === r.assignee_id)?.name} />
        )}{" "}
        {users.find((u) => u.id === r.assignee_id)?.name || "Unassigned"}
      </span>
    ) : ["stage", "status", "priority"].includes(k) ? (
      <Badge>{r.data[k]}</Badge>
    ) : k === "value" ? (
      money(r.data[k])
    ) : k === "probability" ? (
      r.data[k] + "%"
    ) : k.includes("date") || k === "created_at" ? (
      date(r.data[k] || r[k])
    ) : (
      r.data[k] || "—"
    );
  return (
    <>
      <div className="page-head">
        <div className="title-line">
          <h1>{labels[entity]}</h1>
          <span className="count">{total}</span>
        </div>
        <div className="actions">
          {entity === "leads" && writable && (
            <>
              <input
                ref={file}
                type="file"
                accept=".xlsx"
                hidden
                onChange={(e) => importFile(e.target.files[0])}
              />
              <button disabled={busy} onClick={() => file.current.click()}>
                <Upload size={16} />
                Import
              </button>
            </>
          )}
          <button onClick={download}>
            <Download size={16} />
            Export{selected.length ? " (" + selected.length + ")" : ""}
          </button>
          {writable && (
            <button className="primary" onClick={create}>
              <Plus size={18} />
              Create {singular[entity]}
            </button>
          )}
        </div>
      </div>
      <div className="view-tabs">
        <button
          className={!board ? "selected" : ""}
          onClick={() => setBoard(false)}
        >
          <List size={17} />
          All {labels[entity].toLowerCase()}
        </button>
        {["leads", "deals"].includes(entity) && (
          <button
            className={board ? "selected" : ""}
            onClick={() => setBoard(true)}
          >
            <Columns3 size={17} />
            Board
          </button>
        )}
        <span className="view-note">{userFilterLabel(assignee, users)}</span>
      </div>
      <div className="filterbar">
        <div className="search-input">
          <Search size={17} />
          <input
            aria-label="Search records"
            value={q}
            placeholder={"Search " + labels[entity].toLowerCase() + "…"}
            onChange={(e) => filter(setQ, e.target.value)}
          />
        </div>
        <select
          aria-label="Filter by stage or status"
          value={state}
          onChange={(e) => filter(setState, e.target.value)}
        >
          <option value="">All {stateKey(entity)}s</option>
          {states.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        {entity === "leads" && (
          <input
            className="small-input"
            aria-label="Filter source"
            placeholder="Filter source"
            value={source}
            onChange={(e) => filter(setSource, e.target.value)}
          />
        )}
        {entity === "customers" && (
          <input
            className="small-input"
            aria-label="Filter industry"
            placeholder="Filter industry"
            value={industry}
            onChange={(e) => filter(setIndustry, e.target.value)}
          />
        )}
        <select
          aria-label="Filter assignee"
          value={assignee}
          onChange={(e) => filter(setAssignee, e.target.value)}
        >
          <option value="">All assignees</option>
          <option value="unassigned">Unassigned</option>
          {users.map((u) => (
            <option value={u.id} key={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <details className="columns">
          <summary>
            <SlidersHorizontal size={16} />
            Columns
          </summary>
          <div>
            {allColumns.map((c) => (
              <label key={c}>
                <input
                  type="checkbox"
                  checked={cols.includes(c)}
                  onChange={() => column(c)}
                />
                {nice(c)}
              </label>
            ))}
          </div>
        </details>
      </div>
      {error && <div className="error">{error}</div>}
      {selected.length > 0 && (
        <div className="selection-bar">
          {selected.length} records selected{" "}
          <button onClick={() => setSelected([])}>Clear selection</button>
        </div>
      )}
      {busy ? (
        <div className="loading">Loading records…</div>
      ) : board ? (
        <>
          <div className="board">
            {states.map((s) => (
              <section key={s}>
                <h3>
                  <Badge>{s}</Badge>
                  <span>{rows.filter((r) => r.data.stage === s).length}</span>
                </h3>
                {rows
                  .filter((r) => r.data.stage === s)
                  .map((r) => (
                    <button
                      className="board-card"
                      key={r.id}
                      onClick={() => open(entity, r.id)}
                    >
                      <span className="record-key">
                        {entity.slice(0, 3).toUpperCase()}-{r.id.slice(0, 5)}
                      </span>
                      <strong>{r.data.name}</strong>
                      <p>
                        {r.data.company || r.data.service || "No company added"}
                      </p>
                      <div>
                        <span>{money(r.data.value)}</span>
                        <Avatar
                          name={users.find((u) => u.id === r.assignee_id)?.name}
                        />
                      </div>
                    </button>
                  ))}
              </section>
            ))}
          </div>
          <small className="board-note">
            Board shows the current page of filtered records.
          </small>
        </>
      ) : rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="checkbox-cell">
                  <input
                    type="checkbox"
                    aria-label="Select all records on this page"
                    checked={rows.length > 0 && selected.length === rows.length}
                    onChange={(e) =>
                      setSelected(e.target.checked ? rows.map((r) => r.id) : [])
                    }
                  />
                </th>
                {cols.map((k) => (
                  <th key={k}>
                    <button
                      onClick={() => {
                        setSort(k);
                        setDirection(direction === "asc" ? "desc" : "asc");
                      }}
                    >
                      {nice(k)}
                      {sort === k ? (
                        <span>{direction === "asc" ? "↑" : "↓"}</span>
                      ) : (
                        <ChevronDown size={12} />
                      )}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={"Select " + r.data.name}
                      checked={selected.includes(r.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, r.id]
                            : selected.filter((id) => id !== r.id),
                        )
                      }
                    />
                  </td>
                  {cols.map((k) => (
                    <td key={k}>
                      {k === "name" ? (
                        <button
                          className="record-name"
                          onClick={() => open(entity, r.id)}
                        >
                          {cell(r, k)}
                        </button>
                      ) : (
                        cell(r, k)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          text={
            q || state || source || industry || assignee
              ? "No matching records"
              : "No " + labels[entity].toLowerCase() + " yet"
          }
          detail="Create a record or adjust your filters."
        />
      )}
      <footer className="pagination">
        <span>
          {total
            ? `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total}`
            : "0 records"}
          {selected.length ? " · " + selected.length + " selected" : ""}
        </span>
        <div>
          <label>
            Rows per page{" "}
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <button
            className="icon"
            aria-label="Previous page"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <span>
            Page {page} of {Math.max(1, Math.ceil(total / limit))}
          </span>
          <button
            className="icon"
            aria-label="Next page"
            disabled={page * limit >= total}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </footer>
      {importResult && (
        <Dialog title="Import summary" onClose={() => setImportResult(null)}>
          <div className="dialog-body">
            <h3>
              {importResult.imported} imported · {importResult.skipped} skipped
            </h3>
            <p>
              Valid rows were saved. Correct skipped rows and import them again.
            </p>
            {importResult.errors.map((e) => (
              <div className="error" key={e.row}>
                Row {e.row}: {e.message}
              </div>
            ))}
            {importResult.skipped > 100 && <p>Showing the first 100 errors.</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
function userFilterLabel(id, users) {
  return id
    ? id === "unassigned"
      ? "Unassigned records"
      : users.find((u) => u.id === id)?.name
    : "All workspace records";
}
const fields = {
  leads: [
    "name",
    "company",
    "designation",
    "email",
    "phone",
    "alternate_phone",
    "website",
    "gstin",
    "industry",
    "address",
    "source",
    "service",
    "value",
    "close_date",
    "notes",
  ],
  customers: [
    "name",
    "company",
    "gstin",
    "industry",
    "website",
    "email",
    "address",
    "source",
    "contact_name",
    "designation",
    "contact_email",
    "contact_phone",
    "phone",
    "alternate_phone",
    "notes",
  ],
  deals: [
    "name",
    "source",
    "service",
    "value",
    "probability",
    "close_date",
    "notes",
  ],
  activities: ["name", "type", "due_date", "time", "priority", "description"],
};
function RecordPicker({ entity, value, onChange, required = false, label }) {
  const [q, setQ] = useState(""),
    [options, setOptions] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const t = setTimeout(
      () =>
        Promise.all([
          api("/" + entity + "?limit=100&q=" + encodeURIComponent(q)),
          value ? api("/" + entity + "/" + value) : Promise.resolve(null),
        ])
          .then(([r, current]) => {
            if (active)
              setOptions(
                current && !r.rows.some((x) => x.id === current.id)
                  ? [current, ...r.rows]
                  : r.rows,
              );
          })
          .catch((e) => active && setError(e.message)),
      200,
    );
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q, value, entity]);
  return (
    <Field label={label + (required ? " *" : "")}>
      <input
        placeholder={"Find " + labels[entity].toLowerCase()}
        aria-label={"Search " + label}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <select
        required={required}
        value={value || ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{required ? "Select an account" : "None"}</option>
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {r.data.name}
          </option>
        ))}
      </select>
      {error && <small className="error">{error}</small>}
    </Field>
  );
}
function RecordForm({ entity, record, users, stages, onClose, onSave }) {
  const initial = Object.fromEntries(
    fields[entity].map((k) => [
      k,
      ["value", "probability"].includes(k)
        ? 0
        : k === "type"
          ? "Task"
          : k === "priority"
            ? "Medium"
            : "",
    ]),
  );
  const [data, setData] = useState(
      record?.data || {
        ...initial,
        [stateKey(entity)]: stateOptions[entity][0],
      },
    ),
    [assignee, setAssignee] = useState(record?.assignee_id || ""),
    [customer, setCustomer] = useState(record?.customer_id || null),
    [lead, setLead] = useState(record?.lead_id || null),
    [comment, setComment] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function set(k, v) {
    setData((d) => ({ ...d, [k]: v }));
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onSave(
        await api("/" + entity + (record ? "/" + record.id : ""), {
          method: record ? "PUT" : "POST",
          body: {
            data,
            assignee_id: assignee || null,
            ...(["activities", "deals"].includes(entity)
              ? { customer_id: customer }
              : {}),
            ...(entity === "activities" ? { lead_id: lead } : {}),
            ...(record ? { version: record.version } : {}),
            comment,
          },
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const changed =
    record && record.data[stateKey(entity)] !== data[stateKey(entity)];
  return (
    <Dialog
      title={(record ? "Edit " : "Create ") + singular[entity]}
      onClose={onClose}
      wide
    >
      <form onSubmit={save}>
        <div className="dialog-body">
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <div className="form-grid">
            {fields[entity].map((k) => (
              <Field
                key={k}
                label={
                  (k === "name"
                    ? entity === "customers"
                      ? "Display / company name"
                      : "Name"
                    : nice(k)) + (k === "name" ? " *" : "")
                }
              >
                {["notes", "description", "address"].includes(k) ? (
                  <textarea
                    value={data[k] || ""}
                    onChange={(e) => set(k, e.target.value)}
                    rows={3}
                  />
                ) : ["type", "priority"].includes(k) ? (
                  <select
                    value={data[k]}
                    onChange={(e) => set(k, e.target.value)}
                  >
                    {(k === "type"
                      ? ["Call", "Meeting", "Email", "Task", "Follow-up"]
                      : ["Low", "Medium", "High"]
                    ).map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    required={k === "name"}
                    type={
                      k.includes("email")
                        ? "email"
                        : k === "website"
                          ? "url"
                          : ["value", "probability"].includes(k)
                            ? "number"
                            : k.includes("date")
                              ? "date"
                              : k === "time"
                                ? "time"
                                : "text"
                    }
                    min={0}
                    max={k === "probability" ? 100 : undefined}
                    step={k === "value" ? "0.01" : undefined}
                    value={data[k] ?? ""}
                    onChange={(e) =>
                      set(
                        k,
                        ["value", "probability"].includes(k)
                          ? e.target.value === ""
                            ? ""
                            : Number(e.target.value)
                          : e.target.value,
                      )
                    }
                  />
                )}
              </Field>
            ))}
            <Field label="Assignee">
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Unassigned</option>
                {users
                  .filter((u) => u.active || u.id === assignee)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {!u.active ? " (inactive)" : ""}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={nice(stateKey(entity))}>
              <select
                disabled={
                  entity === "leads" && record?.data.stage === "Converted"
                }
                value={data[stateKey(entity)]}
                onChange={(e) => set(stateKey(entity), e.target.value)}
              >
                {(entity === "leads" ? stages : stateOptions[entity])
                  .filter(
                    (s) => record || entity !== "leads" || s !== "Converted",
                  )
                  .map((s) => (
                    <option key={s}>{s}</option>
                  ))}
              </select>
            </Field>
            {["activities", "deals"].includes(entity) && (
              <RecordPicker
                entity="customers"
                label="Customer account"
                value={customer}
                onChange={setCustomer}
                required={entity === "deals"}
              />
            )}
            {entity === "activities" && (
              <RecordPicker
                entity="leads"
                label="Related lead"
                value={lead}
                onChange={setLead}
              />
            )}
          </div>
          {changed && ["leads", "customers"].includes(entity) && (
            <Field label="Reason for this change *">
              <textarea
                required
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add context for your team"
              />
            </Field>
          )}
          {entity === "activities" && data.type === "Email" && (
            <p className="muted">
              Email activities track work; they do not send email.
            </p>
          )}
        </div>
        <footer className="dialog-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save " + singular[entity]}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
function Detail({
  entity,
  id,
  users,
  writable,
  onClose,
  onEdit,
  open,
  refresh,
  notify,
  stages,
}) {
  const [record, setRecord] = useState(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("All"),
    [comment, setComment] = useState(""),
    [state, setState] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const reload = () =>
    api("/" + entity + "/" + id)
      .then((r) => {
        setRecord(r);
        setState(r.data[stateKey(entity)]);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    reload();
  }, [id]);
  async function saveState(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/" + entity + "/" + id, {
        method: "PUT",
        body: {
          data: { ...record.data, [stateKey(entity)]: state },
          version: record.version,
          comment: reason,
        },
      });
      setReason("");
      await reload();
      refresh();
      notify("Status updated");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={
        labels[entity] +
        " / " +
        entity.slice(0, 3).toUpperCase() +
        "-" +
        id.slice(0, 5).toUpperCase()
      }
      onClose={onClose}
      wide
    >
      <div className="dialog-body">
        {error && <div className="error">{error}</div>}
        {!record ? (
          <div className="loading">Loading record…</div>
        ) : (
          <>
            <div className="record-heading">
              <div>
                <Badge>{record.data[stateKey(entity)]}</Badge>
                <h1>{record.data.name}</h1>
                <p>
                  {record.data.company ||
                    record.data.service ||
                    record.data.type}
                </p>
              </div>
              {writable && (
                <button onClick={() => onEdit(record)}>Edit record</button>
              )}
            </div>
            <div className="detail-grid">
              <div>
                <h3>Details</h3>
                <dl className="record-fields">
                  {Object.entries(record.data)
                    .filter(
                      ([k]) =>
                        ![
                          "name",
                          "stage",
                          "status",
                          "notes",
                          "description",
                        ].includes(k),
                    )
                    .map(([k, v]) => (
                      <React.Fragment key={k}>
                        <dt>{nice(k)}</dt>
                        <dd>{k === "value" ? money(v) : v || "—"}</dd>
                      </React.Fragment>
                    ))}
                </dl>
                {(record.data.notes || record.data.description) && (
                  <>
                    <h3>Notes</h3>
                    <p className="prewrap">
                      {record.data.notes || record.data.description}
                    </p>
                  </>
                )}
                {entity === "customers" && (
                  <section className="contact-records">
                    <h3>Contact records</h3>
                    {record.data.contact_name && (
                      <p>
                        <strong>{record.data.contact_name}</strong>
                        <br />
                        {record.data.contact_email || "No email"} ·{" "}
                        {record.data.contact_phone || "No phone"}
                      </p>
                    )}
                    {record.related.leads
                      ?.filter(
                        (l) =>
                          l.data.email !== record.data.contact_email ||
                          l.data.name !== record.data.contact_name,
                      )
                      .map((l) => (
                        <p key={l.id}>
                          <strong>{l.data.name}</strong>
                          <br />
                          {l.data.email || "No email"} ·{" "}
                          {l.data.phone || "No phone"}
                        </p>
                      ))}
                  </section>
                )}
                <div className="history-section">
                  <h3>Activity</h3>
                  <div className="view-tabs">
                    {["All", "Comments", "History"].map((t) => (
                      <button
                        key={t}
                        className={tab === t ? "selected" : ""}
                        onClick={() => setTab(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  {writable && (
                    <form
                      className="comment-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setBusy(true);
                        try {
                          await api("/" + entity + "/" + id + "/comments", {
                            method: "POST",
                            body: { body: comment },
                          });
                          setComment("");
                          await reload();
                          notify("Comment added");
                        } catch (e) {
                          setError(e.message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <textarea
                        aria-label="Add comment"
                        placeholder="Add a comment for your team…"
                        maxLength={5000}
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                      />
                      <button
                        className="primary"
                        disabled={busy || !comment.trim()}
                      >
                        Add comment
                      </button>
                    </form>
                  )}
                  <div className="events">
                    {record.events
                      .filter(
                        (e) =>
                          tab === "All" ||
                          e.kind ===
                            (tab === "Comments" ? "comment" : "history"),
                      )
                      .map((e) => (
                        <article key={e.id}>
                          <Avatar name={e.author} />
                          <div>
                            <strong>{e.author}</strong>
                            <small>
                              {e.kind === "comment"
                                ? " commented"
                                : " updated this record"}{" "}
                              · {new Date(e.created_at).toLocaleString("en-IN")}
                            </small>
                            <p>{e.body}</p>
                          </div>
                        </article>
                      ))}
                  </div>
                </div>
              </div>
              <aside className="detail-aside">
                <h3>Ownership & status</h3>
                <div className="owner">
                  <Avatar
                    name={users.find((u) => u.id === record.assignee_id)?.name}
                  />
                  <span>
                    {users.find((u) => u.id === record.assignee_id)?.name ||
                      "Unassigned"}
                  </span>
                </div>
                <small>Created {date(record.created_at)}</small>
                <small>Updated {date(record.updated_at)}</small>
                {writable && (
                  <form onSubmit={saveState}>
                    <Field label={nice(stateKey(entity))}>
                      <select
                        value={state}
                        disabled={
                          entity === "leads" &&
                          record.data.stage === "Converted"
                        }
                        onChange={(e) => setState(e.target.value)}
                      >
                        {(entity === "leads"
                          ? stages
                          : stateOptions[entity]
                        ).map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </Field>
                    {state !== record.data[stateKey(entity)] && (
                      <>
                        <Field label="Change comment">
                          <textarea
                            required={["leads", "customers"].includes(entity)}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                          />
                        </Field>
                        <button className="primary" disabled={busy}>
                          Update {stateKey(entity)}
                        </button>
                      </>
                    )}
                  </form>
                )}
                {record.customer_id && (
                  <button
                    className="link-button"
                    onClick={() => open("customers", record.customer_id)}
                  >
                    Open linked customer <ArrowUpRight size={15} />
                  </button>
                )}
                {record.lead_id && (
                  <button
                    className="link-button"
                    onClick={() => open("leads", record.lead_id)}
                  >
                    Open linked lead <ArrowUpRight size={15} />
                  </button>
                )}
                {Object.entries(record.related).map(([type, rows]) => (
                  <section key={type}>
                    <h3>
                      {labels[type]}{" "}
                      <span className="count">{rows.length}</span>
                    </h3>
                    {rows.length ? (
                      rows.map((r) => (
                        <button
                          className="related"
                          key={r.id}
                          onClick={() => open(type, r.id)}
                        >
                          {r.data.name}
                          <small>{r.data.stage || r.data.status}</small>
                        </button>
                      ))
                    ) : (
                      <p className="muted">No related records</p>
                    )}
                  </section>
                ))}
              </aside>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
function Reports({ revision }) {
  const [d, setD] = useState(null),
    [err, setErr] = useState("");
  useEffect(() => {
    api("/dashboard")
      .then(setD)
      .catch((e) => setErr(e.message));
  }, [revision]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p>A closer look at your customer base and pipeline.</p>
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      {d ? (
        <div className="report-grid">
          <section className="panel">
            <div className="panel-head">
              <h2>Customers by industry</h2>
            </div>
            <Distribution items={d.industries} />
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Leads by stage</h2>
            </div>
            <Distribution items={d.stages} />
          </section>
        </div>
      ) : (
        <div className="loading">Loading reports…</div>
      )}
    </>
  );
}
function Team({ users, refresh, notify }) {
  const [editing, setEditing] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Team members</h1>
          <p>Manage workspace access and ownership.</p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setError("");
            setEditing({
              name: "",
              email: "",
              role: "Sales Executive",
              active: true,
              password: "",
            });
          }}
        >
          <Plus size={17} />
          Add team member
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <span className="assignee">
                    <Avatar name={u.name} />
                    {u.name}
                  </span>
                </td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>
                  <Badge>{u.active ? "Active" : "Inactive"}</Badge>
                </td>
                <td>
                  <button
                    onClick={() => {
                      setError("");
                      setEditing({ ...u, password: "" });
                    }}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <Dialog
          title={editing.id ? "Edit team member" : "Add team member"}
          onClose={() => setEditing(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const { id, password, ...body } = editing;
                await api("/users" + (id ? "/" + id : ""), {
                  method: id ? "PUT" : "POST",
                  body: { ...body, ...(password ? { password } : {}) },
                });
                setEditing(null);
                refresh();
                notify("Team member saved");
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="dialog-body">
              {error && <div className="error">{error}</div>}
              {["name", "email", "password"].map((k) => (
                <Field
                  key={k}
                  label={
                    k === "password" && editing.id
                      ? "New password (leave blank to keep)"
                      : nice(k)
                  }
                >
                  <input
                    type={k === "name" ? "text" : k}
                    required={k !== "password" || !editing.id}
                    minLength={k === "password" ? 12 : undefined}
                    value={editing[k]}
                    onChange={(e) =>
                      setEditing({ ...editing, [k]: e.target.value })
                    }
                  />
                </Field>
              ))}
              <Field label="Role">
                <select
                  value={editing.role}
                  onChange={(e) =>
                    setEditing({ ...editing, role: e.target.value })
                  }
                >
                  {roles.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={editing.active}
                  onChange={(e) =>
                    setEditing({ ...editing, active: e.target.checked })
                  }
                />
                Active account
              </label>
            </div>
            <footer className="dialog-footer">
              <button type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                Save member
              </button>
            </footer>
          </form>
        </Dialog>
      )}
    </>
  );
}
function SettingsPage({ value, refresh, notify }) {
  const [form, setForm] = useState(value),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Company details and lead workflow.</p>
        </div>
      </div>
      <form
        className="panel settings-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("/settings", { method: "PUT", body: form });
            refresh();
            notify("Settings saved");
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <div className="error">{error}</div>}
        <h2>Company profile</h2>
        <div className="form-grid">
          {[
            "company_name",
            "logo_url",
            "address",
            "gstin",
            "email",
            "phone",
            "website",
          ].map((k) => (
            <Field key={k} label={nice(k)}>
              <input
                required={k === "company_name"}
                type={
                  k === "email"
                    ? "email"
                    : ["logo_url", "website"].includes(k)
                      ? "url"
                      : "text"
                }
                value={form[k] || ""}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <h2>Lead workflow</h2>
        <Field label="Stages (one per line)">
          <textarea
            rows={5}
            value={form.lead_stages.join("\n")}
            onChange={(e) =>
              setForm({ ...form, lead_stages: e.target.value.split("\n") })
            }
          />
        </Field>
        <p className="muted">
          Keep New, Contacted and Converted. You can add additional stages.
        </p>
        <button className="primary" disabled={busy}>
          Save settings
        </button>
      </form>
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
