"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  API,
  Attachment,
  Delivery,
  Role,
  Subscription,
  Ticket,
  User,
} from "./api";

const statuses = ["new", "in_progress", "done", "rejected"];
const label = (value: string) =>
  value === "in_progress"
    ? "In progress"
    : value.charAt(0).toUpperCase() + value.slice(1);
const date = (value: string) =>
  new Date(value).toLocaleDateString("en", { month: "short", day: "numeric" });
function DeskIcon({ name, className = "" }: { name: string; className?: string }) {
  const paths: Record<string, React.ReactNode> = {
    inbox: <><path d="M4 4h16l2 10v6H2v-6L4 4Z" /><path d="M2 14h6l2 3h4l2-3h6" /></>,
    waves: <><path d="M3 7c3-4 6 4 9 0s6 4 9 0M3 12c3-4 6 4 9 0s6 4 9 0M3 17c3-4 6 4 9 0s6 4 9 0" /></>,
    team: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5" /></>,
    connect: <><path d="m9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 7l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" /></>,
    message: <><path d="M21 11a9 9 0 0 1-9 9H4l-3 2 2-6a9 9 0 1 1 18-5Z" /><path d="M7 9h10M7 13h6" /></>,
    exit: <><path d="M9 4H3v16h6M8 12h13m-5-5 5 5-5 5" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  };
  return <svg className={`desk-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.inbox}</svg>;
}

function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      <i />
      {label(status)}
    </span>
  );
}
function ErrorMessage({ error }: { error: Error | null }) {
  return error ? (
    <p className="error" role="alert">
      {error.message}
    </p>
  ) : null;
}

export function Workspace() {
  const client = useQueryClient();
  const [session, setSession] = useState<{
    access_token: string;
    user: User;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [section, setSection] = useState("Requests");
  useEffect(() => {
    const token = sessionStorage.getItem("relaydesk-token");
    if (token)
      api<User>("/auth/me", token)
        .then((user) => setSession({ access_token: token, user }))
        .catch(() => sessionStorage.removeItem("relaydesk-token"))
        .finally(() => setReady(true));
    else setReady(true);
  }, []);
  if (!ready) return <div className="loading" role="status"><span className="harbor-mark"><DeskIcon name="waves" /></span><strong>HarborDesk</strong><div className="loading-bars"><i /><i /><i /></div>Opening your workspace…</div>;
  if (!session)
    return (
      <Login
        onLogin={(value) => {
          sessionStorage.setItem("relaydesk-token", value.access_token);
          setSession(value);
        }}
      />
    );
  const { user, access_token: token } = session;
  return (
    <div className="shell">
      <aside className="inbox-rail">
        <a href="/" className="harbor-mark" aria-label="HarborDesk home" title="HarborDesk">
          <DeskIcon name="waves" />
        </a>
        <nav aria-label="Workspace navigation">
          {["Requests", ...(user.role === "admin" ? ["Webhooks", "Team"] : [])].map((item) => (
            <button key={item} title={item} aria-label={item} aria-current={section === item ? "page" : undefined} className={section === item ? "active" : ""} onClick={() => setSection(item)}>
              <DeskIcon name={item === "Requests" ? "inbox" : item === "Team" ? "team" : "connect"} />
              <span>{item === "Requests" ? "Inbox" : item}</span>
            </button>
          ))}
        </nav>
        <div className="rail-account">
          <div className="avatar" title={`${user.name} · ${label(user.role)}`}>
            {user.name.split(" ").map((n) => n[0]).join("")}
          </div>
          <button aria-label="Sign out" title="Sign out" onClick={() => {
            sessionStorage.removeItem("relaydesk-token");
            client.clear();
            setSession(null);
            setSection("Requests");
          }}><DeskIcon name="exit" /></button>
        </div>
      </aside>
      <main>
        <header className="desk-header">
          <div className="desk-identity"><strong>HarborDesk</strong><span className="workspace-caption">Customer support</span></div>
          <div className="desk-user"><span>{user.name}<small>{label(user.role)}</small></span><span className="avatar small">{user.name[0]}</span></div>
        </header>
        <div className="content">
          {section === "Requests" ? (
            <Requests token={token} user={user} />
          ) : section === "Team" ? (
            <Team token={token} user={user} />
          ) : (
            <Webhooks token={token} />
          )}
        </div>
      </main>
    </div>
  );
}

function Login({
  onLogin,
}: {
  onLogin: (value: { access_token: string; user: User }) => void;
}) {
  const [email, setEmail] = useState("admin@relaydesk.local");
  const [password, setPassword] = useState("RelayDesk123!");
  const login = useMutation({
    mutationFn: () =>
      api<{ access_token: string; user: User }>("/auth/login", "", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    onSuccess: onLogin,
  });
  return (
    <div className="login-page">
      <a href="/" className="login-brand"><span className="harbor-mark"><DeskIcon name="waves" /></span>HarborDesk</a>
      <div className="login-intro"><span className="eyebrow">THE CUSTOMER SUPPORT INBOX</span><h1>A good day starts<br />with a clear inbox.</h1><p>One place for every request. A little more room to help.</p></div>
      <div className="login-panel">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
        >
          <span className="eyebrow">YOUR SUPPORT WORKSPACE</span>
          <h2>Welcome back</h2>
          <p>Pick up the conversation with your customers.</p>
          <label>
            Email address
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <ErrorMessage error={login.error} />
          <button className="primary full" aria-label="Sign in to RelayDesk — HarborDesk workspace" disabled={login.isPending}>
            {login.isPending ? "Signing in…" : "Open your inbox →"}
          </button>
          <div className="role-picker">
            <strong>Explore the support desk</strong>
            <p>Choose a demo role. Password: RelayDesk123!</p>
            <div>
              {["admin", "agent", "customer"].map((role) => (
                <button
                  type="button"
                  key={role}
                  onClick={() => {
                    setEmail(`${role}@relaydesk.local`);
                    setPassword("RelayDesk123!");
                  }}
                >
                  {label(role)}
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Requests({ token, user }: { token: string; user: User }) {
  const client = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: ["requests"],
    queryFn: () => api<Ticket[]>("/requests", token),
  });
  const requests = query.data || [];
  const filtered = requests.filter(
    (item) =>
      (filter === "all" || item.status === filter) &&
      `${item.title} ${item.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="inbox-heading">
        <div><span className="eyebrow">HARBORDESK / SHARED INBOX</span><h1>Every request. In view.<span className="count">{requests.length}</span></h1>
          <p>{user.role === "customer" ? "A direct line to your team. We’re here to help." : "Triage the queue, keep the context, move things forward."}</p>
        </div>
        <button className="primary" onClick={() => setCreating(true)}>＋ New request</button>
      </div>
      <div className="queue-summary" aria-label="Queue summary">
        <span><i className="status-dot new" /><strong>{requests.filter((r) => r.status === "new").length}</strong> New requests</span>
        <span><i className="status-dot in_progress" /><strong>{requests.filter((r) => r.status === "in_progress").length}</strong> In progress</span>
        <span><i className="status-dot done" /><strong>{requests.filter((r) => r.status === "done").length}</strong> Resolved</span>
        <span className="queue-total">{requests.length} total requests</span>
      </div>
      <div className={`inbox-split ${selected !== null ? "has-conversation" : ""}`}>
        <section className="queue-pane" aria-label="Request inbox">
          <div className="queue-heading"><h2><DeskIcon name="inbox" /> Inbox</h2><span>{filtered.length} requests</span></div>
          <div className="queue-tools">
            <input className="search" aria-label="Search requests" placeholder="Search by subject or request ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="tabs" aria-label="Request status filters">
              {["all", ...statuses].map((status) => (
                <button key={status} onClick={() => setFilter(status)} className={filter === status ? "selected" : ""} aria-pressed={filter === status}>
                  {label(status)}<span>{status === "all" ? requests.length : requests.filter((r) => r.status === status).length}</span>
                </button>
              ))}
            </div>
          </div>
          <ErrorMessage error={query.error} />
          <div className="queue-list">
            {query.isPending ? <div className="empty" role="status"><div className="loading-bars"><i /><i /><i /></div>Loading requests…</div> : <>
              {filtered.map((item) => (
                <button key={item.id} className={`conversation-row ${item.status === "new" ? "is-new" : ""} ${selected === item.id ? "is-selected" : ""}`} onClick={() => setSelected(item.id)} aria-pressed={selected === item.id}>
                  <span className="requester-avatar" aria-label={`Customer ${item.customer_id}`}>C{item.customer_id}</span>
                  <span className="conversation-preview">
                    <span className="conversation-meta"><span>Customer #{item.customer_id}</span><time>{date(item.updated_at)}</time></span>
                    <span className="conversation-subject">{item.status === "new" && <i className="new-indicator" title="New request" />}{item.title}</span>
                    <span className="conversation-snippet">{item.description}</span>
                    <span className="conversation-labels"><Badge status={item.status} /><span className="request-reference">RD-{String(item.id).padStart(4, "0")}</span><span className="request-created">Created {date(item.created_at)}</span></span>
                  </span>
                </button>
              ))}
              {filtered.length === 0 && <div className="empty"><DeskIcon name="inbox" /><h3>{search || filter !== "all" ? "No matching requests" : "A fresh start"}</h3><p>{search || filter !== "all" ? "Try another search or status." : "Create a request and your team will take it from here."}</p></div>}
            </>}
          </div>
          <div className="queue-footer"><span>Showing {filtered.length} of {requests.length}</span><span>200 most recent max.</span></div>
        </section>
        {selected !== null ? <Detail key={selected} id={selected} token={token} user={user} onClose={() => setSelected(null)} /> : (
          <section className="conversation-idle" aria-label="Conversation details">
            <div className="idle-topline"><DeskIcon name="message" /> Conversation</div>
            <div className="idle-content"><div className="inbox-art"><DeskIcon name="inbox" /><span className="art-message"><DeskIcon name="message" /></span><span className="art-check">✓</span></div>
              <span className="eyebrow">A LITTLE CONTEXT GOES A LONG WAY</span><h2>Make room for<br />a better conversation.</h2><p>Select a request from the inbox to see the full story, manage its status and share attachments.</p>
              <div className="idle-hint"><span>←</span> Your next conversation is on the left</div>
            </div>
            <div className="idle-bottom"><DeskIcon name="waves" /><span>HarborDesk · A home for helpful conversations</span></div>
          </section>
        )}
      </div>
      {creating && <Modal title="New request" onClose={() => setCreating(false)}><RequestForm token={token} onSaved={(item) => {
        client.invalidateQueries({ queryKey: ["requests"] });
        setCreating(false);
        setSelected(item.id);
      }} /></Modal>}
    </>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={panel}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Tab") {
            const elements = panel.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]",
            );
            if (!elements?.length) return;
            const first = elements[0],
              last = elements[elements.length - 1];
            if (
              e.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === panel.current)
            ) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button aria-label="Close dialog" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function RequestForm({
  token,
  item,
  onSaved,
}: {
  token: string;
  item?: Ticket;
  onSaved: (item: Ticket) => void;
}) {
  const [title, setTitle] = useState(item?.title || "");
  const [description, setDescription] = useState(item?.description || "");
  const save = useMutation({
    mutationFn: () =>
      api<Ticket>(item ? `/requests/${item.id}` : "/requests", token, {
        method: item ? "PATCH" : "POST",
        body: JSON.stringify({ title, description }),
      }),
    onSuccess: onSaved,
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <label>
        Subject
        <input
          autoFocus
          required
          maxLength={200}
          placeholder="What can we help with?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        Description
        <textarea
          required
          maxLength={10000}
          rows={5}
          placeholder="A few details help us get started…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <ErrorMessage error={save.error} />
      <button className="primary" disabled={save.isPending}>
        {save.isPending ? "Saving…" : item ? "Save changes" : "Create request"}
      </button>
    </form>
  );
}

function Detail({
  id,
  token,
  user,
  onClose,
}: {
  id: number;
  token: string;
  user: User;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [downloadError, setDownloadError] = useState<Error | null>(null);
  const conversation = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    conversation.current?.focus();
    return () => previous?.focus();
  }, []);
  const query = useQuery({
    queryKey: ["request", id],
    queryFn: () => api<Ticket>(`/requests/${id}`, token),
  });
  const files = useQuery({
    queryKey: ["attachments", id],
    queryFn: () => api<Attachment[]>(`/requests/${id}/attachments`, token),
  });
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["requests"] });
    client.invalidateQueries({ queryKey: ["request", id] });
  };
  const status = useMutation({
    mutationFn: (value: string) =>
      api(`/requests/${id}/status`, token, {
        method: "PATCH",
        body: JSON.stringify({ status: value }),
      }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => api(`/requests/${id}`, token, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api(`/requests/${id}/attachments`, token, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["attachments", id] }),
  });
  async function download(file: Attachment) {
    try {
      setDownloadError(null);
      const response = await fetch(`${API}/attachments/${file.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Unable to download attachment");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setDownloadError(error as Error);
    }
  }
  const item = query.data;
  return (
    <section ref={conversation} tabIndex={-1} role="dialog" aria-modal="false" className="conversation-pane" aria-label={`Request RD-${String(id).padStart(4, "0")}`} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="conversation-header"><span><DeskIcon name="message" /> Request RD-{String(id).padStart(4, "0")}</span><button className="close-conversation" aria-label="Close request" onClick={onClose}>×</button></div>
      <div className="conversation-body">
      <ErrorMessage error={query.error} />
      {item ? (
        <>
          {editing ? (
            <RequestForm
              token={token}
              item={item}
              onSaved={() => {
                refresh();
                setEditing(false);
              }}
            />
          ) : (
            <>
              <div className="detail-status"><Badge status={item.status} /><span className="muted">Updated {date(item.updated_at)}</span></div>
              <h2 className="detail-title">{item.title}</h2>
              <div className="message-card">
                <div className="message-author"><span className="requester-avatar">C{item.customer_id}</span><div><strong>Customer #{item.customer_id}</strong><small>Request opened · {date(item.created_at)}</small></div><DeskIcon name="message" /></div>
                <p className="description">{item.description}</p>
              </div>
              <div className="triage-label">REQUEST ACTIONS</div>
              <div className="actions">
                {user.role !== "customer" &&
                  (item.status === "new"
                    ? ["in_progress"]
                    : item.status === "in_progress"
                      ? ["done", "rejected"]
                      : []
                  ).map((next) => (
                    <button
                      className="primary"
                      key={next}
                      disabled={status.isPending}
                      onClick={() => status.mutate(next)}
                    >
                      Mark {label(next).toLowerCase()}
                    </button>
                  ))}
                {(user.role !== "customer" || item.status === "new") && (
                  <>
                    <button
                      className="secondary"
                      onClick={() => setEditing(true)}
                    >
                      Edit request
                    </button>
                    <button
                      className="danger"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Delete this request and its attachments?",
                          )
                        )
                          remove.mutate();
                      }}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </>
          )}
          <ErrorMessage error={status.error || remove.error} />
          <div className="attachment-section">
            <h3>
              Attachments{" "}
              <span className="muted">{files.data?.length || 0}</span>
            </h3>
            <p className="muted">PDF, PNG, JPEG or text · Up to 5 MiB each</p>
            <label className="upload-box">
              {upload.isPending ? "Uploading…" : "＋ Add an attachment"}
              <input
                aria-label="Add an attachment"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.txt"
                disabled={upload.isPending}
                onChange={(e) => {
                  if (e.target.files?.[0]) upload.mutate(e.target.files[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <ErrorMessage
              error={upload.error || files.error || downloadError}
            />
            {files.data?.map((file) => (
              <button
                className="file-row"
                key={file.id}
                onClick={() => download(file)}
              >
                <span>▧ {file.filename}</span>
                <span>{Math.ceil(file.size / 1024)} KB ↓</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="empty" role="status"><div className="loading-bars"><i /><i /><i /></div>Loading request…</div>
      )}
      </div>
    </section>
  );
}

function Team({ token, user }: { token: string; user: User }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["users"],
    queryFn: () => api<User[]>("/users", token),
  });
  const [adding, setAdding] = useState(false);
  const change = useMutation({
    mutationFn: ({ id, role }: { id: number; role: string }) =>
      api(`/users/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["users"] }),
  });
  const create = useMutation({
    mutationFn: (body: object) =>
      api("/users", token, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      setAdding(false);
      client.invalidateQueries({ queryKey: ["users"] });
    },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    create.mutate(Object.fromEntries(new FormData(e.currentTarget)));
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">THE PEOPLE BEHIND THE PROGRESS</div>
          <h1>Your team</h1>
          <p>Give everyone the right space to do their best work.</p>
        </div>
        <button className="primary" onClick={() => setAdding(true)}>
          ＋ Add user
        </button>
      </div>
      <ErrorMessage error={query.error || change.error} />
      <section className="request-panel">
        <table>
          <thead>
            <tr>
              <th>NAME</th>
              <th>EMAIL</th>
              <th>ROLE</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.map((member) => (
              <tr key={member.id}>
                <td>{member.name}</td>
                <td>{member.email}</td>
                <td>
                  <select
                    aria-label={`Role for ${member.name}`}
                    value={member.role}
                    disabled={member.id === user.id || change.isPending}
                    onChange={(e) =>
                      change.mutate({ id: member.id, role: e.target.value })
                    }
                  >
                    {(["admin", "agent", "customer"] as Role[]).map((role) => (
                      <option key={role}>{role}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {query.isPending && <div className="empty">Loading team…</div>}
      </section>
      {adding && (
        <Modal
          title="Add a teammate or customer"
          onClose={() => setAdding(false)}
        >
          <form onSubmit={submit}>
            <label>
              Full name
              <input name="name" required maxLength={100} />
            </label>
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            <label>
              Initial password
              <input
                name="password"
                type="password"
                minLength={10}
                maxLength={128}
                required
              />
            </label>
            <label>
              Role
              <select name="role" defaultValue="customer">
                <option>customer</option>
                <option>agent</option>
                <option>admin</option>
              </select>
            </label>
            <ErrorMessage error={create.error} />
            <button className="primary" disabled={create.isPending}>
              Create user
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

function Webhooks({ token }: { token: string }) {
  const client = useQueryClient();
  const [adding, setAdding] = useState(false);
  const query = useQuery({
    queryKey: ["webhooks"],
    queryFn: () => api<Subscription[]>("/webhooks", token),
  });
  const logs = useQuery({
    queryKey: ["deliveries"],
    queryFn: () => api<Delivery[]>("/webhooks/deliveries", token),
    refetchInterval: 3000,
  });
  const create = useMutation({
    mutationFn: (body: object) =>
      api("/webhooks", token, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      setAdding(false);
      client.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) =>
      api(`/webhooks/${id}`, token, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["webhooks"] }),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">KEEP EVERYTHING CONNECTED</div>
          <h1>Webhooks</h1>
          <p>Send signed status updates to the tools your team already uses.</p>
        </div>
        <button className="primary" onClick={() => setAdding(true)}>
          ＋ Add endpoint
        </button>
      </div>
      <ErrorMessage error={query.error || logs.error || remove.error} />
      <section className="request-panel">
        <div className="panel-heading">
          <h2>Subscriptions</h2>
          <span className="muted">request.status_changed</span>
        </div>
        {query.isPending && <div className="empty">Loading subscriptions…</div>}
        {query.data?.length === 0 && (
          <div className="empty">
            No endpoints yet. Add one to connect your workflow.
          </div>
        )}
        {query.data?.map((item) => (
          <div className="endpoint" key={item.id}>
            <div>
              <strong>{item.url}</strong>
              <small>
                Endpoint #{item.id} · {item.active ? "Active" : "Disabled"}
              </small>
            </div>
            {item.active && (
              <button
                className="secondary"
                disabled={remove.isPending}
                onClick={() => remove.mutate(item.id)}
              >
                Disable
              </button>
            )}
          </div>
        ))}
      </section>
      <section className="request-panel log-panel">
        <div className="panel-heading">
          <div>
            <h2>Delivery activity</h2>
            <p>One automatic retry. A record of every outcome.</p>
          </div>
          <span className="live">
            <i /> Updates every 3s
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>DELIVERY</th>
                <th>ENDPOINT</th>
                <th>STATUS</th>
                <th>ATTEMPTS</th>
                <th>RESPONSE</th>
              </tr>
            </thead>
            <tbody>
              {logs.data?.map((item) => (
                <tr key={item.id}>
                  <td>#{item.id}</td>
                  <td>#{item.subscription_id}</td>
                  <td>
                    <Badge status={item.status} />
                  </td>
                  <td>{item.attempts} / 2</td>
                  <td>{item.response_code || item.error || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!logs.data?.length && (
          <div className="empty">
            {logs.isPending
              ? "Loading deliveries…"
              : "Change a request status to send your first event."}
          </div>
        )}
      </section>
      {adding && (
        <Modal title="Connect an endpoint" onClose={() => setAdding(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(Object.fromEntries(new FormData(e.currentTarget)));
            }}
          >
            <label>
              Endpoint URL
              <input
                type="url"
                name="url"
                required
                placeholder="https://example.com/webhooks"
              />
            </label>
            <label>
              Signing secret
              <input
                name="secret"
                type="password"
                minLength={16}
                maxLength={200}
                required
              />
            </label>
            <p className="muted">
              Save this secret in your receiver. Deliveries are signed with
              HMAC-SHA256.
            </p>
            <ErrorMessage error={create.error} />
            <button className="primary" disabled={create.isPending}>
              Create subscription
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
