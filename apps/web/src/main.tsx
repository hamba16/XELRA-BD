import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LensSwitcher,
  SplitMark,
  type Lens,
} from "../../../packages/lab/src/ui/LensSwitcher";
import {
  ApprovalCard,
  type Approval,
} from "../../../packages/lab/src/ui/ApprovalCard";
import { rank, type Command } from "../../../packages/lab/src/ui/commands";
import { Outbox } from "../../../packages/lab/src/lib/offline-queue";
import { reconcile, type Line } from "../../../packages/lab/src/lib/recon";
import { BrowserStore } from "./queue";
import {
  configured,
  live,
  supabase,
  downloadFile,
  type Backend,
  type Snapshot,
  type Division,
  type Profile,
} from "./data";
import "../../../packages/lab/src/ui/tokens.css";
import "./style.css";
import { RequestWorkspace, ApprovalHealth } from "./RequestWorkspace";
import { sendFieldJob } from "./field-attachments";
const BusinessWorkspace = lazy(() => import("./BusinessWorkspace"));
const FinanceWorkspace = lazy(() => import("./FinanceWorkspace"));
const LocalDocumentFile = lazy(() => import("./LocalDocumentFile"));
const NotificationHistory = lazy(() => import("./BusinessWorkspace").then(m => ({ default: m.NotificationHistory })));

const money = (n: number) =>
  new Intl.NumberFormat("en-UG", {
    style: "currency",
    currency: "UGX",
    maximumFractionDigits: 0,
  }).format(n);
const label = (s: string) =>
  s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const divisions: Record<Division, string> = {
  ENG: "Engineering",
  AMG: "Asset Management",
  COR: "Corporate",
};
function App() {
  const devLoginEnabled =
    import.meta.env.DEV && import.meta.env.VITE_DEV_LOGIN === "true";
  const [backend, setBackend] = useState<Backend | null>(null),
    [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [lens, setLens] = useState<Lens>("combined"),
    [page, setPage] = useState(location.pathname.split("/")[1] || "inbox");
  const [form, setForm] = useState(""),
    [search, setSearch] = useState(""),
    [palette, setPalette] = useState(false),
    [query, setQuery] = useState(""),
    [message, setMessage] = useState(""),
    [theme, setTheme] = useState("light");
  const [queueCount, setQueueCount] = useState(0),
    [queueOpen, setQueueOpen] = useState(false),
    [syncing, setSyncing] = useState(false),
    [syncError, setSyncError] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [sent, setSent] = useState(false),
    [authBusy, setAuthBusy] = useState(false);
  const [devProfiles, setDevProfiles] = useState<Profile[]>([]),
    [selectedDevProfile, setSelectedDevProfile] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const [update, setUpdate] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        if (reg.waiting) setUpdate(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            )
              setUpdate(worker);
          });
        });
      })
      .catch(() => {});
  }, []);
  const preview = backend !== null && backend !== live;
  async function refresh(b = backend) {
    if (!b) return;
    setLoading(true);
    try {
      setData(await b.load());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (devLoginEnabled || !supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setBackend(live);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setBackend(session ? live : null);
      if (!session) setData(null);
    });
    return () => sub.subscription.unsubscribe();
  }, [devLoginEnabled]);
  useEffect(() => {
    if (!devLoginEnabled) return;
    let active = true;
    void import("./dev/profiles")
      .then(({ loadDevProfiles }) => {
        const profiles = loadDevProfiles();
        if (active) {
          setDevProfiles(profiles);
          setSelectedDevProfile(profiles[0]?.id || "");
        }
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [devLoginEnabled]);
  useEffect(() => {
    if (backend) {
      if (location.pathname.startsWith("/auth/")) {
        history.replaceState({}, "", "/inbox");
        setPage("inbox");
      }
      void refresh(backend);
    } else setTheme("light");
  }, [backend]);
  useEffect(() => {
    const pop = () => setPage(location.pathname.split("/")[1] || "inbox");
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const can = (p: string) => Boolean(data?.profile.permissions.includes(p));
  const canSee = {
    eng: Boolean(
      data && (data.profile.divisions.includes("ENG") || can("view.combined")),
    ),
    amg: Boolean(
      data && (data.profile.divisions.includes("AMG") || can("view.combined")),
    ),
  };
  useEffect(() => {
    if (!data) return;
    setLens(
      canSee.eng && canSee.amg
        ? "combined"
        : canSee.eng
          ? "eng"
          : canSee.amg
            ? "amg"
            : "combined",
    );
  }, [data?.profile.id]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const store = useMemo(
    () => (data ? new BrowserStore(data.profile.id) : null),
    [data?.profile.id],
  );
  const outbox = useMemo(
    () =>
      store && backend
        ? new Outbox(store, async (job) => {
            const localTransport = backend !== live ? { upload: async (file: import("./local-files").StoredFile) => {
              const { LocalFileStore } = await import("./local-files");
              const saved = await new LocalFileStore(data!.profile.id).put(file.id, new File([file.blob], file.name, { type: file.type }));
              return { key: `photos/local/${file.id}`, sha256: saved.sha256 };
            }} : null;
            return sendFieldJob(job, localTransport, args => backend.rpc("sync_field_report", args));
          })
        : null,
    [store, backend],
  );
  async function sync() {
    if (!outbox) return;
    setSyncing(true);
    try {
      const result = await outbox.flush();
      setQueueCount(result.pending);
      setSyncError(result.lastError || "");
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }
  useEffect(() => {
    if (!store) return;
    store
      .all()
      .then((j) => setQueueCount(j.length))
      .catch((e) => setSyncError(e.message));
    void sync();
    const online = () => void sync();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [store, outbox]);
  useEffect(() => {
    if (!backend || preview) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void backend.signOut(), 15 * 60 * 1000);
    };
    reset();
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [backend]);
  function nav(next: string) {
    setPage(next);
    setForm("");
    setSearch("");
    setPalette(false);
    history.pushState({}, "", `/${next}`);
  }
  const navItems = [
    ["inbox", "Inbox", ""],
    ["projects", "Projects", "projects.read"],
    ["people", "People", ""],
    ["documents", "Documents", "documents.read"],
    ["finance", "Finance", ""],
    ["capture", "Field reports", ""],
    ["help", "Helpdesk", ""],
    ["admin", "Administration", "ops.read"],
  ].filter(
    ([id, , perm]) =>
      (!(id === "finance" || id === "people" || id === "capture") || data?.profile.principal === "staff" || (id === "capture" && data?.profile.principal === "contractor")) && (!perm ||
      can(perm) ||
      (id === "projects" && Boolean(data?.projects.length)) ||
      (id === "documents" && Boolean(data?.documents.length))),
  );
  const commands: Command[] = navItems.map(([id, name]) => ({
    id,
    label: name,
    group: "Go to",
    run: () => nav(id),
  }));
  if (data?.profile.principal === "staff")
    for (const kind of ["leave", "expense", "requisition"])
      commands.push({
        id: kind,
        label:
          kind === "leave"
            ? "Request leave"
            : kind === "expense"
              ? "Claim an expense"
              : "Raise a requisition",
        group: "Create",
        run: () => {
          nav("inbox");
          setForm(kind);
          setPalette(false);
        },
      });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (palette) dialog.current?.showModal();
    else dialog.current?.close();
  }, [palette]);
  async function auth(action: "oauth" | "send" | "verify") {
    if (!supabase) return;
    setAuthBusy(true);
    setError("");
    try {
      const result =
        action === "oauth"
          ? await supabase.auth.signInWithOAuth({
              provider: "azure",
              options: {
                scopes: "email",
                redirectTo: location.origin + "/auth/callback/",
              },
            })
          : action === "send"
            ? await supabase.auth.signInWithOtp({
                email,
                options: {
                  shouldCreateUser: false,
                  emailRedirectTo: location.origin + "/auth/callback/",
                },
              })
            : await supabase.auth.verifyOtp({
                email,
                token: code,
                type: "email",
              });
      if (result.error) throw result.error;
      if (action === "send") setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAuthBusy(false);
    }
  }
  async function startDevLogin() {
    const profile = devProfiles.find((p) => p.id === selectedDevProfile);
    if (!profile) {
      setError("Choose a development profile first.");
      return;
    }
    setAuthBusy(true);
    setError("");
    try {
      const { createPreview } = await import("./dev/preview");
      setBackend(createPreview(profile));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAuthBusy(false);
    }
  }
  async function startPreview() {
    const { preview: b } = await import("./dev/preview");
    setBackend(b);
  }
  async function signOut() {
    if (backend) {
      await backend.signOut();
      setBackend(null);
      setData(null);
      setMessage("");
    }
  }
  if (!backend)
    return (
      <div className="signin">
        <section className="brand-panel">
          <SplitMark
            lens="combined"
            canSee={{ eng: true, amg: true }}
            size={94}
          />
          <p className="eyebrow">DRENIAK · LIVE THE FUTURE</p>
          <h1>
            One company.
            <br />A clearer working day.
          </h1>
          <p>
            Engineering and Asset Management.
            <br />
            Connected work. Considered decisions.
          </p>
          <img
            src="/brand/lens-states.png"
            alt="The Dreniak division mark, shown in four access states"
          />
        </section>
        <section className="signin-form">
          <span className="wordmark">
            XELRA<span> / </span>WORKSPACE
          </span>
          <h2>Welcome back.</h2>
          <p className="muted">
            Your work, decisions and documents in one place.
          </p>
          {devLoginEnabled ? (
            <>
              <p className="notice">
                Development-only profile switcher. It uses synthetic local data
                and does not authenticate with Supabase or access real records.
              </p>
              <label>
                Development profile
                <select
                  aria-label="Development profile"
                  value={selectedDevProfile}
                  onChange={(e) => setSelectedDevProfile(e.target.value)}
                  disabled={!devProfiles.length}
                >
                  <option value="" disabled>
                    {devProfiles.length
                      ? "Choose a profile"
                      : "Loading profiles…"}
                  </option>
                  {devProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary wide"
                disabled={authBusy || !selectedDevProfile}
                onClick={() => void startDevLogin()}
              >
                {authBusy ? "Opening profile…" : "Log in"}
              </button>
            </>
          ) : configured ? (
            <>
              <button
                className="primary wide"
                disabled={authBusy}
                onClick={() => void auth("oauth")}
              >
                Continue with Microsoft
              </button>
              <div className="divider">Or use your invitation email</div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void auth(sent ? "verify" : "send");
                }}
              >
                <label>
                  Email address
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                {sent && (
                  <label>
                    One-time code
                    <input
                      required
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </label>
                )}
                <button disabled={authBusy} className="wide">
                  {sent ? "Verify code" : "Send sign-in code"}
                </button>
              </form>
              {sent && (
                <p role="status">Check your email for the sign-in code.</p>
              )}
            </>
          ) : (
            <p className="notice">
              This workspace is awaiting its secure connection. Sign-in will be
              available when your administrator completes setup.
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {!devLoginEnabled && import.meta.env.DEV && !configured && (
            <button
              className="preview-button"
              onClick={() => void startDevLogin()}
            >
              Open sample walkthrough
            </button>
          )}
          <footer>
            XELRA · Dreniak Limited
            <br />
            Authorised access only.
          </footer>
        </section>
      </div>
    );
  if (!data)
    return (
      <main className="loading">
        <h1>XELRA</h1>
        <p role="status">{loading ? "Opening your workspace…" : error}</p>
        {!loading && <button onClick={() => void refresh()}>Try again</button>}
        <button onClick={() => void signOut()}>Sign out</button>
      </main>
    );
  const inLens = (r: { division: Division }) =>
    lens === "combined" || r.division === (lens === "eng" ? "ENG" : "AMG");
  const requests = data.requests.filter(inLens),
    projects = data.projects.filter(inLens),
    documents = data.documents.filter(inLens);
  const pending = requests.filter(
    (r) => r.status === "pending" && r.can_decide,
  );
  const filteredDocs = documents.filter((d) =>
    `${d.doc_no} ${d.title}`.toLowerCase().includes(search.toLowerCase()),
  );
  const title =
    (
      {
        inbox: "Your working day",
        projects: "Projects",
        people: "People",
        documents: "Document centre",
        finance: "Finance",
        capture: "Field reports",
        help: "Helpdesk",
        admin: "Administration",
      } as Record<string, string>
    )[page] || "Page not found";
  const dashboardActions: {
    label: string;
    description: string;
    icon: string;
    run: () => void;
  }[] = [];
  if (data.profile.principal === "staff") {
    dashboardActions.push(
      {
        label: "New field report",
        description: "Capture a note from the field",
        icon: "▧",
        run: () => nav("capture"),
      },
      {
        label: "Request leave",
        description: "Record time away from work",
        icon: "◷",
        run: () => setForm("leave"),
      },
      {
        label: "Claim expense",
        description: "Submit an expense for review",
        icon: "▤",
        run: () => setForm("expense"),
      },
      {
        label: "Raise requisition",
        description: "Request a purchase",
        icon: "＋",
        run: () => setForm("requisition"),
      },
    );
  } else {
    if (projects.length)
      dashboardActions.push({
        label: "View projects",
        description: "Open your project register",
        icon: "▦",
        run: () => nav("projects"),
      });
    if (documents.length)
      dashboardActions.push({
        label: "Open documents",
        description: "Browse released documents",
        icon: "▤",
        run: () => nav("documents"),
      });
    dashboardActions.push({
      label: "Ask IT for help",
      description: "Open the helpdesk",
      icon: "?",
      run: () => nav("help"),
    });
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const node = e.currentTarget;
    const f = new FormData(node);
    setLoading(true);
    setError("");
    try {
      const division = String(f.get("division"));
      if (form === "helpdesk" || form === "register")
        await backend!.rpc("create_record", {
          p_module: form === "helpdesk" ? "helpdesk" : f.get("module"),
          p_division: division,
          p_title: f.get("title"),
          p_data: { description: f.get("description") },
          p_expires: f.get("expires") || null,
        });
      else
        await backend!.rpc("submit_request", {
          p_kind: form,
          p_division: division,
          p_amount: f.get("amount") ? Number(f.get("amount")) : null,
          p_payload: {
            title: f.get("title"),
            description: f.get("description"),
            starts: f.get("starts") || null,
            ends: f.get("ends") || null,
          },
        });
      sessionStorage.removeItem(`xelra-draft-${data!.profile.id}-${form}`);
      setForm("");
      setMessage("Submitted. Your request is recorded.");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function capture(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (capturing) return;
    const node = e.currentTarget,
      f = new FormData(node);
    setError("");
    setCapturing(true);
    try {
      const id = crypto.randomUUID();
      const files = f.getAll("photos").filter((value): value is File => value instanceof File && value.size > 0);
      if (files.length > 6) throw Error("Choose at most six photos per field report.");
      const { compressPhoto, fileDigest } = await import("./local-files");
      const photos = [];
      for (const file of files) {
        const compressed = await compressPhoto(file);
        photos.push({ id: crypto.randomUUID(), name: compressed.name, type: compressed.type, size: compressed.size, sha256: await fileDigest(compressed), blob: compressed, createdAt: Date.now() });
      }
      await outbox!.enqueue(
        "field_report",
        {
          p_client: id,
          p_project: f.get("project"),
          p_body: { note: f.get("note") },
          p_captured: new Date().toISOString(),
          local_photos: photos,
        },
        id,
      );
      setQueueCount((await store!.all()).length);
      setMessage("Saved on this phone. Use Sync now to send.");
      node.reset();
      void navigator.storage?.persist();
    } catch (e) {
      setError((e as Error).message);
    } finally { setCapturing(false); }
  }
  const selection = (
    <label>
      Division
      <select name="division" required>
        {data.profile.divisions.map((d) => (
          <option key={d} value={d}>
            {divisions[d]}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="rail">
        <button className="brand-link" onClick={() => nav("inbox")}>
          <SplitMark lens={lens} canSee={canSee} size={44} />
          <span>
            XELRA<small>DRENIAK</small>
          </span>
        </button>
        <p className="rail-label">WORKSPACE</p>
        <nav>
          {navItems.map(([id, name], i) => (
            <button
              key={id}
              aria-current={page === id ? "page" : undefined}
              onClick={() => nav(id)}
            >
              <span className="nav-symbol" aria-hidden="true">
                {["◫", "▤", "♙", "▧", "≋", "⊕", "?"][i]}
              </span>
              {name}
              {id === "inbox" && pending.length > 0 && (
                <span className="count">{pending.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="rail-bottom">
          <span className="avatar">
            {data.profile.name
              .split(" ")
              .map((s) => s[0])
              .slice(0, 2)
              .join("")}
          </span>
          <strong>{data.profile.name}</strong>
          <small>{label(data.profile.principal)}</small>
          <button onClick={() => void signOut()}>Sign out</button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          {data.profile.principal === "staff" || data.profile.principal === "it_admin" ? <LensSwitcher value={lens} onChange={setLens} canSee={canSee} /> : <strong>{data.profile.principal === "client" ? "Your projects" : data.profile.principal === "contractor" ? "Your engagements" : "Audit workspace"}</strong>}
          <div className="top-actions">
            <button className="search-command" onClick={() => setPalette(true)}>
              Find or do something <kbd>Ctrl K</kbd>
            </button>
            <button
              className={syncError ? "error" : "sync"}
              onClick={() => setQueueOpen((v) => !v)}
            >
              {syncing
                ? "↻ Syncing"
                : syncError
                  ? "! Needs attention"
                  : queueCount
                    ? `◷ ${queueCount} on this phone`
                    : "✓ Saved"}
            </button>
            <button
              aria-label={`Use ${theme === "light" ? "dark" : "light"} theme`}
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? "◐" : "◑"}
            </button>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <div className={`page-heading${page === "inbox" ? " dashboard-hero" : ""}`}>
            {page === "inbox" && (
              <img
                className="dashboard-hero-image"
                src="/ag-rosa-render.webp"
                alt=""
                aria-hidden="true"
              />
            )}
            <div className="page-heading-copy">
              <p className="eyebrow">
                {lens === "combined"
                  ? "DRENIAK WORKSPACE"
                  : lens === "eng"
                    ? "ENGINEERING"
                    : "ASSET MANAGEMENT"}
              </p>
              <h1>{title}</h1>
              <p className="muted">
                {page === "inbox"
                  ? "Decisions, people and progress. Start with what needs you."
                  : page === "capture"
                    ? "Record the work where it happens. Send it when you have signal."
                    : "A shared view of the work you can access."}
              </p>
            </div>
            <div className="actions">
              <button onClick={() => void refresh()} disabled={loading}>
                Refresh
              </button>
            </div>
          </div>
          {preview && (
            <p className="preview-strip">
              Sample walkthrough · synthetic records · changes last for this
              session
            </p>
          )}
          {update && (
            <p className="notice">
              An update is available. Save any open form before reloading.{" "}
              <button
                onClick={() => {
                  navigator.serviceWorker.addEventListener(
                    "controllerchange",
                    () => location.reload(),
                    { once: true },
                  );
                  update.postMessage("ACTIVATE");
                }}
              >
                Reload with update
              </button>
            </p>
          )}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="notice" role="status">
              {message}
              <button
                onClick={() => setMessage("")}
                aria-label="Dismiss message"
              >
                ×
              </button>
            </p>
          )}
          {queueOpen && (
            <section className="queue-panel">
              <h2>Saved on this device</h2>
              <p>
                {queueCount} report{queueCount === 1 ? "" : "s"} waiting to
                send. Local copies are removed only after the server confirms
                receipt.
              </p>
              {syncError && <p role="alert">{syncError}</p>}
              <button
                disabled={syncing || queueCount === 0}
                onClick={() => void sync()}
              >
                Sync now
              </button>
            </section>
          )}
          {form && (
            <section className="form-panel">
              <h2>
                {form === "leave"
                  ? "Request leave"
                  : form === "expense"
                    ? "Claim an expense"
                    : form === "helpdesk"
                      ? "Ask IT for help"
                      : form === "register"
                        ? "Add a register entry"
                        : "Raise a requisition"}
              </h2>
              <DraftForm
                key={form}
                draftKey={`xelra-draft-${data.profile.id}-${form}`}
                onSubmit={submit}
              >
                {selection}
                {form === "register" && (
                  <label>
                    Register
                    <select name="module">
                      {[
                        "certifications",
                        "assets",
                        "suppliers",
                        "benefits",
                        "recruitment",
                        "checklists",
                        "portfolio",
                      ].map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Title
                  <input name="title" maxLength={200} required />
                </label>
                {form === "leave" && (
                  <div className="form-grid">
                    <label>
                      First day
                      <input name="starts" type="date" required />
                    </label>
                    <label>
                      Last day
                      <input name="ends" type="date" required />
                    </label>
                  </div>
                )}
                {["expense", "requisition"].includes(form) && (
                  <label>
                    Amount · UGX
                    <input
                      name="amount"
                      type="number"
                      min="1"
                      step="1"
                      required
                    />
                  </label>
                )}
                <label>
                  Details
                  <textarea
                    name="description"
                    maxLength={8000}
                    rows={3}
                    required
                  />
                </label>
                {form === "register" && (
                  <label>
                    Expiry date, if applicable
                    <input name="expires" type="date" />
                  </label>
                )}
                <div className="actions">
                  <button className="primary" disabled={loading}>
                    Submit
                  </button>
                  <button type="button" onClick={() => setForm("")}>
                    Close draft
                  </button>
                </div>
              </DraftForm>
            </section>
          )}
          {page === "inbox" && (
            <>
              <Suspense fallback={<p>Loading notifications…</p>}><NotificationHistory backend={backend} /></Suspense>
              <section className="summary">
                <div className="summary-card">
                  <span className="summary-icon" aria-hidden="true">▦</span>
                  <div>
                    <p>Projects in view</p>
                    <strong>{projects.length}</strong>
                    <small>Authorised project register</small>
                  </div>
                </div>
                <div className="summary-card">
                  <span className="summary-icon" aria-hidden="true">◷</span>
                  <div>
                    <p>Waiting on you</p>
                    <strong>{pending.length}</strong>
                    <small>Decisions ready to make</small>
                  </div>
                </div>
                <div className="summary-card">
                  <span className="summary-icon" aria-hidden="true">□</span>
                  <div>
                    <p>Your open requests</p>
                    <strong>
                      {
                        requests.filter(
                          (r) =>
                            r.requester === data.profile.id &&
                            r.status === "pending",
                        ).length
                      }
                    </strong>
                    <small>Follow progress below</small>
                  </div>
                </div>
                <div className="summary-card">
                  <span className="summary-icon" aria-hidden="true">↥</span>
                  <div>
                    <p>Field queue</p>
                    <strong>{queueCount}</strong>
                    <small>
                      {queueCount
                        ? "Saved on this device"
                        : "Nothing waiting to sync"}
                    </small>
                  </div>
                </div>
              </section>
              <section className="dashboard-quick-actions" aria-labelledby="quick-actions-heading">
                <h2 id="quick-actions-heading">Quick actions</h2>
                <div className="quick-action-grid">
                  {dashboardActions.map((action) => {
                    return (
                      <button
                        className="quick-action"
                        key={action.label}
                        onClick={action.run}
                      >
                        <span className="quick-action-icon" aria-hidden="true">
                          {action.icon}
                        </span>
                        <span>
                          <strong>{action.label}</strong>
                          <small>{action.description}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
              <div className="section-heading">
                <h2>
                  Waiting on you <span>{pending.length}</span>
                </h2>
              </div>
              <div className="approval-list">
                {pending.length ? (
                  pending.map((r) => (
                    <ApprovalCard
                      key={r.id}
                      a={{
                        id: r.id,
                        kind: r.kind as Approval["kind"],
                        title: r.payload.title,
                        requester: r.requester_name,
                        amountUgx: r.amount_ugx,
                        submittedAt: new Date(r.created_at).toLocaleDateString(
                          "en-GB",
                        ),
                        step: r.current_step,
                        steps: r.steps,
                        waitingOn: r.waiting_on,
                      }}
                      onDecide={async (id, approve, comment) => {
                        try {
                          await backend.rpc("decide_request", {
                            p_id: id,
                            p_approve: approve,
                            p_comment: comment || null,
                          });
                          setMessage(
                            approve
                              ? "Decision recorded."
                              : "Sent back with your reason.",
                          );
                          await refresh();
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    />
                  ))
                ) : (
                  <Empty
                    title="Nothing waiting on you."
                    text="New decisions will appear here when they need your attention."
                  />
                )}
              </div>
              <RequestWorkspace
                key={`${data.profile.id}-${lens}`}
                backend={backend}
                data={data}
                division={
                  lens === "combined" ? null : lens === "eng" ? "ENG" : "AMG"
                }
                onChanged={() => refresh()}
              />
            </>
          )}
          {page === "projects" && <Suspense fallback={<p>Loading workspace?</p>}><BusinessWorkspace mode="projects" backend={backend} data={data} onChanged={() => void refresh()} /></Suspense>}
          {page === "documents" && (
            <>
              {can("documents.create") && (
                <form
                  className="form-panel"
                >
                  <h3>Create document draft</h3>
                  <div className="form-grid">
                    <label>
                      Division
                      <select name="division" defaultValue={lens === "eng" ? "ENG" : lens === "amg" ? "AMG" : "COR"}>
                        <option value="ENG">Engineering</option>
                        <option value="AMG">Asset Management</option>
                        <option value="COR">Corporate</option>
                      </select>
                    </label>
                    <label>
                      Project
                      <input name="project" placeholder="P014 or CORP" />
                    </label>
                    <label>
                      Document type
                      <select name="type">
                        <option value="RPT">Report</option>
                        <option value="DWG">Drawing</option>
                        <option value="LTR">Letter</option>
                        <option value="CTR">Contract</option>
                        <option value="QTN">Quotation</option>
                        <option value="PO">Purchase order</option>
                        <option value="INV">Invoice</option>
                        <option value="MIN">Minutes</option>
                        <option value="POL">Policy</option>
                      </select>
                    </label>
                    <label>
                      Title
                      <input name="title" required maxLength={200} />
                    </label>
                    <label className="span">
                      Excerpt
                      <textarea name="excerpt" maxLength={4096} />
                    </label>
                  </div>
                  <button
                    type="submit"
                    onClick={async (event) => {
                      event.preventDefault();
                      const form = event.currentTarget.form;
                      if (!form || !backend) return;
                      const values = new FormData(form);
                      try {
                        await backend.rpc("create_document", {
                          p_division: String(values.get("division")),
                          p_project: String(values.get("project") || "CORP"),
                          p_type: String(values.get("type")),
                          p_title: String(values.get("title")),
                          p_excerpt: String(values.get("excerpt") || ""),
                        });
                        form.reset();
                        setMessage("Document draft created.");
                        await refresh(backend);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Create draft
                  </button>
                </form>
              )}
              <label className="filter">
                Find by number or title
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="DRN-ENG-P014…"
                />
              </label>
              <div
                className="table-wrap"
                tabIndex={0}
                role="region"
                aria-label="Scrollable records"
              >
                <table>
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Title</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDocs.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <button
                            className="code"
                            onClick={() =>
                              void navigator.clipboard
                                .writeText(d.doc_no)
                                .then(() =>
                                  setMessage("Document number copied."),
                                )
                                .catch(() =>
                                  setError(
                                    "Copy is unavailable in this browser.",
                                  ),
                                )
                            }
                          >
                            {d.doc_no}
                          </button>
                        </td>
                        <td>{d.title}</td>
                        <td>
                          <Status value={d.status} />
                        </td>
                        <td>
                          <div className="action-stack">
                            {d.status === "released" && !preview && (
                              <button
                                onClick={() =>
                                  void downloadFile(d.id).catch((e) =>
                                    setError(e.message),
                                  )
                                }
                              >
                                Download
                              </button>
                            )}
                            {preview && d.can_manage && <Suspense fallback={<span>Loading file controls?</span>}><LocalDocumentFile backend={backend} profile={data.profile} document={d} onSaved={() => void refresh()} /></Suspense>}
                            {!preview && d.can_manage && d.status === "draft" && !d.has_file && <small>File upload is not configured for this workspace.</small>}
                            {d.can_manage && d.status === "draft" && (
                              <>
                                <button
                                  onClick={async () => {
                                    if (!backend) return;
                                    try {
                                      await backend.rpc("submit_document", {
                                        p_id: d.id,
                                      });
                                      setMessage("Document submitted for review.");
                                      await refresh(backend);
                                    } catch (e) {
                                      setError((e as Error).message);
                                    }
                                  }}
                                >
                                  Submit for review
                                </button>
                              </>
                            )}
                            {d.can_release && d.status === "in_review" && (
                              <button
                                onClick={async () => {
                                  if (!backend) return;
                                  try {
                                    await backend.rpc("release_document", {
                                      p_id: d.id,
                                    });
                                    setMessage("Document released.");
                                    await refresh(backend);
                                  } catch (e) {
                                    setError((e as Error).message);
                                  }
                                }}
                              >
                                Release
                              </button>
                            )}
                            {d.can_manage && d.status === "released" && (
                              <button
                                onClick={async () => {
                                  if (!backend) return;
                                  try {
                                    await backend.rpc(
                                      "create_document_revision",
                                      { p_id: d.id },
                                    );
                                    setMessage("Document revision created.");
                                    await refresh(backend);
                                  } catch (e) {
                                    setError((e as Error).message);
                                  }
                                }}
                              >
                                Create revision
                              </button>
                            )}
                            {d.can_manage &&
                              ["draft", "in_review"].includes(d.status) && (
                                <button
                                  onClick={async () => {
                                    if (!backend) return;
                                    try {
                                      await backend.rpc("withdraw_document", {
                                        p_id: d.id,
                                      });
                                      setMessage("Document withdrawn.");
                                      await refresh(backend);
                                    } catch (e) {
                                      setError((e as Error).message);
                                    }
                                  }}
                                >
                                  Withdraw
                                </button>
                              )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filteredDocs.length && (
                  <Empty
                    title="No documents found."
                    text="Released documents appear here when they are available to you."
                  />
                )}
              </div>
            </>
          )}
          {page === "people" && <Suspense fallback={<p>Loading workspace?</p>}><BusinessWorkspace mode="people" backend={backend} data={data} onChanged={() => void refresh()} /></Suspense>}
          {page === "capture" && (
            <section className="form-panel">
              <h2>New site note</h2>
              {projects.length ? (
                <form onSubmit={capture}>
                  <label>
                    Project
                    <select name="project" required>
                      {projects.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.code} · {p.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    What happened on site?
                    <textarea name="note" required maxLength={12000} rows={6} />
                  </label>
                  <label>Site photos (optional, up to six)<input name="photos" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple /></label>
                  {!preview && <small>Photos remain on this device until photo delivery is available.</small>}
                  <div className="actions">
                    <button className="primary" disabled={capturing}>{capturing ? "Saving photos and report?" : "Save on this device"}</button>
                    <button
                      type="button"
                      disabled={!queueCount || syncing}
                      onClick={() => void sync()}
                    >
                      Sync now
                    </button>
                  </div>
                  <p className="muted">
                    Keep this app installed and sync regularly. Your browser may
                    clear device storage.
                  </p>
                </form>
              ) : (
                <Empty
                  title="No assigned projects."
                  text="Ask your project lead for access before capturing a report."
                />
              )}
            </section>
          )}
          {page === "finance" && <Suspense fallback={<p>Loading workspace?</p>}><FinanceWorkspace backend={backend} data={data} /></Suspense>}
          {page === "help" && <Suspense fallback={<p>Loading workspace?</p>}><BusinessWorkspace mode="help" backend={backend} data={data} onChanged={() => void refresh()} /></Suspense>}
          {page === "admin" && can("ops.read") && <><Health backend={backend} /><Suspense fallback={<p>Loading audit verification?</p>}><BusinessWorkspace mode="admin" backend={backend} data={data} onChanged={() => void refresh()} /></Suspense></>}
          {![
            "inbox",
            "projects",
            "people",
            "documents",
            "finance",
            "capture",
            "help",
            "admin",
          ].includes(page) && (
            <Empty
              title="This page could not be found."
              text="Use the navigation to return to your workspace."
            />
          )}
          <footer className="app-footer">
            XELRA · Dreniak Limited <span>Pre-production workspace</span>
          </footer>
        </main>
        <nav className="mobile-nav">
          <button
            aria-current={page === "inbox" ? "page" : undefined}
            onClick={() => nav("inbox")}
          >
            Inbox
          </button>
          <button
            aria-current={page === "capture" ? "page" : undefined}
            onClick={() => nav("capture")}
          >
            Capture
          </button>
          <button onClick={() => setPalette(true)}>Find</button>
          <button onClick={() => void signOut()}>Sign out</button>
        </nav>
      </div>
      <dialog
        ref={dialog}
        onCancel={() => setPalette(false)}
        onClick={(e) => {
          if (e.target === dialog.current) setPalette(false);
        }}
      >
        <div className="palette">
          <div className="actions">
            <input
              autoFocus
              aria-label="Find a page or action"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a page or action…"
            />
            <button onClick={() => setPalette(false)}>Close</button>
          </div>
          {rank(commands, query).map((c) => (
            <button key={c.id} onClick={() => c.run(nav)}>
              <span>{c.label}</span>
              <small>{c.group}</small>
            </button>
          ))}
          {!rank(commands, query).length && <p>No matching actions.</p>}
        </div>
      </dialog>
    </div>
  );
}
function Health({ backend }: { backend: Backend }) {
  const [health, setHealth] = useState<{
      backup_ok: boolean;
      keepalive_ok: boolean;
      restore_drill_ok: boolean;
      meters: {
        kind: string;
        ratio: number;
        stale: boolean;
        critical: boolean;
        warning: boolean;
      }[];
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    backend
      .rpc("health", {})
      .then((h) => setHealth(h as NonNullable<typeof health>))
      .catch((e) => setError(e.message));
  }, [backend]);
  if (error) return <p role="alert">{error}</p>;
  if (!health) return <p role="status">Checking operations health?</p>;
  return (
    <section className="form-panel">
      <h2>Operations health</h2>
      <ApprovalHealth backend={backend} />
      <p>Backup: {health.backup_ok ? "Recent success" : "Needs attention"}</p>
      <p>
        Keepalive: {health.keepalive_ok ? "Recent success" : "Needs attention"}
      </p>
      <p>
        Restore drill:{" "}
        {health.restore_drill_ok ? "Recent success" : "Needs attention"}
      </p>
      {health.meters.map((m) => (
        <p key={m.kind}>
          {label(m.kind)} ? {Math.round(m.ratio * 100)}% ?{" "}
          {m.stale
            ? "Stale measurement"
            : m.critical
              ? "Critical"
              : m.warning
                ? "Warning"
                : "Within capacity"}
        </p>
      ))}
    </section>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <section className="empty">
      <span aria-hidden="true">◫</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </section>
  );
}
function Status({ value }: { value: string }) {
  const good = ["approved", "active", "on track", "released"].includes(value);
  return (
    <span className={`status ${good ? "good" : ""}`}>
      <span aria-hidden="true">{good ? "✓" : "◷"}</span>{" "}
      {label(value === "rejected" ? "sent back" : value)}
    </span>
  );
}
function DraftForm({
  draftKey,
  onSubmit,
  children,
}: {
  draftKey: string;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLFormElement>(null),
    [saved, setSaved] = useState("");
  useEffect(() => {
    try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey) || "{}");
      for (const [name, value] of Object.entries(draft)) {
        const el = ref.current?.elements.namedItem(name);
        if (
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLSelectElement
        )
          el.value = String(value);
      }
    } catch {}
  }, [draftKey]);
  return (
    <form
      ref={ref}
      onSubmit={onSubmit}
      onChange={() => {
        try {
          sessionStorage.setItem(
            draftKey,
            JSON.stringify(Object.fromEntries(new FormData(ref.current!))),
          );
          setSaved("Draft saved in this tab.");
        } catch {
          setSaved("Draft storage unavailable. Keep this tab open.");
        }
      }}
    >
      {children}
      <p role="status" className="muted">
        {saved}
      </p>
    </form>
  );
}
function Reconciliation() {
  const [bank, setBank] = useState(""),
    [ledger, setLedger] = useState(""),
    [output, setOutput] = useState<ReturnType<typeof reconcile> | null>(null),
    [error, setError] = useState("");
  const parse = (text: string): Line[] =>
    text
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((row, i) => {
        const [id, date, amount, ...description] = row.split("\t");
        if (
          !id ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)) ||
          !Number.isFinite(Number(amount)) ||
          !description.length
        )
          throw Error(
            `Line ${i + 1}: use ID, date (YYYY-MM-DD), signed UGX amount and description, separated by tabs.`,
          );
        return {
          id,
          date,
          amount: Number(amount),
          text: description.join(" "),
        };
      });
  return (
    <section className="form-panel">
      <h2>Bank reconciliation · shadow mode</h2>
      <p>
        Paste statement and ledger rows from your spreadsheet. Suggestions stay
        on this device and do not post to the ledger.
      </p>
      <div className="form-grid">
        <label>
          Bank rows
          <textarea
            value={bank}
            onChange={(e) => setBank(e.target.value)}
            rows={7}
            placeholder="ID → date → signed UGX → description"
          />
        </label>
        <label>
          Ledger rows
          <textarea
            value={ledger}
            onChange={(e) => setLedger(e.target.value)}
            rows={7}
          />
        </label>
      </div>
      <button
        className="primary"
        onClick={() => {
          try {
            const b = parse(bank),
              l = parse(ledger);
            if (b.length > 500 || l.length > 500)
              throw Error("Match up to 500 rows at a time.");
            if (
              new Set(b.map((x) => x.id)).size !== b.length ||
              new Set(l.map((x) => x.id)).size !== l.length
            )
              throw Error("Each row needs a unique ID.");
            setOutput(reconcile(b, l));
            setError("");
          } catch (e) {
            setError((e as Error).message);
            setOutput(null);
          }
        }}
      >
        Find suggestions
      </button>
      {error && <p role="alert">{error}</p>}
      {output && (
        <div aria-live="polite">
          <p>
            {output.auto.length} strong suggestions · {output.suggest.length}{" "}
            need review · {output.unmatched.length} unmatched
          </p>
          <ul>
            {output.auto.map(([b, l]) => (
              <li key={b}>
                {b} → {l} · review before posting
              </li>
            ))}
            {output.suggest.map((s) => (
              <li key={s.bank}>
                {s.bank} · candidates {s.options.map(([id]) => id).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
