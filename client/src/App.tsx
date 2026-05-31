import { FormEvent, useState } from "react";
import { useRetro, votesUsed, type Card } from "./store";

export function App() {
  const user = useRetro((s) => s.user);
  return (
    <div className="page">
      <header className="masthead">
        <h1>
          Retro<span>Board</span>
        </h1>
        <p>
          Live sprint retrospective · JWT + bcrypt auth · WebSocket sync · Zustand
          state
        </p>
      </header>
      {user ? <Board /> : <Login />}
      <footer className="foot">
        Add cards, and spend your dot-votes on what matters most. Everyone sees
        changes instantly; your vote budget is enforced by the server against
        your signed token.
      </footer>
    </div>
  );
}

function Login() {
  const authenticate = useRetro((s) => s.authenticate);
  const status = useRetro((s) => s.status);
  const error = useRetro((s) => s.error);
  const [mode, setMode] = useState<"login" | "register">("register");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  const busy = status === "connecting";
  const valid = name.trim().length > 0 && password.length >= 4;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) authenticate(mode, name.trim(), password);
  };

  return (
    <form className="card login" onSubmit={submit}>
      <div className="tabs">
        <button
          type="button"
          className={mode === "register" ? "on" : ""}
          onClick={() => setMode("register")}
        >
          Create account
        </button>
        <button
          type="button"
          className={mode === "login" ? "on" : ""}
          onClick={() => setMode("login")}
        >
          Log in
        </button>
      </div>

      <label htmlFor="name">Name</label>
      <input
        id="name"
        autoFocus
        autoComplete="username"
        placeholder="e.g. nadia"
        value={name}
        maxLength={20}
        onChange={(e) => setName(e.target.value)}
      />

      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        autoComplete={mode === "register" ? "new-password" : "current-password"}
        placeholder="at least 4 characters"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <button type="submit" disabled={busy || !valid}>
        {busy
          ? "Connecting…"
          : mode === "register"
            ? "Create account & join"
            : "Log in & join"}
      </button>

      {error && <p className="error">{error}</p>}
      <p className="hint">
        Passwords are hashed with bcrypt server-side; a successful{" "}
        {mode === "register" ? "registration" : "login"} returns a signed JWT
        that authorizes your WebSocket. Open two tabs with different accounts to
        run a retro together.
      </p>
    </form>
  );
}

function Board() {
  const { user, status, online, users, logout } = useRetro((s) => ({
    user: s.user!,
    status: s.status,
    online: s.online,
    users: s.users,
    logout: s.logout,
  }));
  const columns = useRetro((s) => s.columns);

  return (
    <div className="board-wrap">
      <aside className="card sidebar">
        <div className="me">
          <span className="chip" style={{ background: user.color }} />
          <div>
            <strong>{user.name}</strong>
            <small className={`status ${status}`}>{statusLabel(status)}</small>
          </div>
          <button className="ghost" onClick={logout}>
            Leave
          </button>
        </div>

        <VoteBudget />

        <div className="presence">
          <h3>In this retro · {online}</h3>
          <ul>
            {users.map((u) => (
              <li key={u.name}>
                <span className="chip sm" style={{ background: u.color }} />
                {u.name}
                {u.name === user.name && <em> (you)</em>}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <div className="columns">
        {columns.map((col) => (
          <ColumnView key={col.id} id={col.id} title={col.title} />
        ))}
      </div>
    </div>
  );
}

function VoteBudget() {
  const budget = useRetro((s) => s.voteBudget);
  const used = useRetro(votesUsed);
  const notice = useRetro((s) => s.notice);
  const remaining = Math.max(0, budget - used);

  return (
    <div className="votes">
      <h3>Your votes · {remaining} left</h3>
      <div className="dots">
        {Array.from({ length: budget }).map((_, i) => (
          <span key={i} className={`dot ${i < used ? "spent" : ""}`} />
        ))}
      </div>
      {notice && <p className="notice">{notice}</p>}
    </div>
  );
}

function ColumnView({ id, title }: { id: string; title: string }) {
  const cards = useRetro((s) => s.cards.filter((c) => c.columnId === id));
  const addCard = useRetro((s) => s.addCard);
  const [text, setText] = useState("");

  // Most-voted first within a column.
  const sorted = [...cards].sort((a, b) => b.voters.length - a.voters.length);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) {
      addCard(id, text);
      setText("");
    }
  };

  return (
    <section className="column">
      <h2>
        {title} <span className="count">{cards.length}</span>
      </h2>

      <form className="composer" onSubmit={submit}>
        <textarea
          rows={2}
          maxLength={280}
          placeholder="Add a card…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) submit(e);
          }}
        />
        <button type="submit" disabled={!text.trim()}>
          Add
        </button>
      </form>

      <div className="cards">
        {sorted.map((card) => (
          <CardView key={card.id} card={card} />
        ))}
      </div>
    </section>
  );
}

function CardView({ card }: { card: Card }) {
  const me = useRetro((s) => s.user!.name);
  const toggleVote = useRetro((s) => s.toggleVote);
  const deleteCard = useRetro((s) => s.deleteCard);
  const voted = card.voters.includes(me);
  const mine = card.author === me;

  return (
    <div className="retro-card">
      <p className="text">{card.text}</p>
      <div className="card-foot">
        <span className="author">
          <span className="chip sm" style={{ background: card.authorColor }} />
          {card.author}
        </span>
        <div className="actions">
          {mine && (
            <button
              className="del"
              title="Delete (author only)"
              onClick={() => deleteCard(card.id)}
            >
              ✕
            </button>
          )}
          <button
            className={`vote ${voted ? "on" : ""}`}
            onClick={() => toggleVote(card.id)}
            title={voted ? "Remove your vote" : "Vote"}
          >
            ▲ {card.voters.length}
          </button>
        </div>
      </div>
    </div>
  );
}

function statusLabel(s: string) {
  switch (s) {
    case "open":
      return "live";
    case "connecting":
      return "connecting";
    case "closed":
      return "disconnected";
    case "error":
      return "error";
    default:
      return s;
  }
}
