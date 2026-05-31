import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { WebSocketServer } from "ws";

// --- config -----------------------------------------------------------------
const PORT = Number(process.env.PORT) || 8787;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const VOTE_BUDGET = Number(process.env.VOTE_BUDGET) || 5;
const TOKEN_TTL = "8h";
const SALT_ROUNDS = 10;
const MAX_CARD_LEN = 280;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_FILE = path.join(__dirname, "users.json");

// Fixed columns for now — could be per-board config later.
const COLUMNS = [
  { id: "good", title: "What went well 🎉" },
  { id: "improve", title: "What to improve 🔧" },
  { id: "actions", title: "Action items ✅" },
];
const COLUMN_IDS = new Set(COLUMNS.map((c) => c.id));

// Author-tag colors, picked from the name so they stay stable.
const PALETTE = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

function colorFor(name) {
  const hash = crypto.createHash("sha1").update(name.toLowerCase()).digest();
  return PALETTE[hash[0] % PALETTE.length];
}

// card: { id, columnId, text, author, authorColor, voters: string[] }
let cards = [];

function votesUsedBy(name) {
  return cards.reduce((n, c) => n + (c.voters.includes(name) ? 1 : 0), 0);
}

// lowercased name -> { name, color, passwordHash }, saved to JSON so accounts
// survive a restart (the board doesn't).
const users = new Map();

function loadUsers() {
  try {
    const raw = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    for (const u of raw) users.set(u.name.toLowerCase(), u);
    console.log(`Loaded ${users.size} user(s) from ${path.basename(USERS_FILE)}`);
  } catch {
    // No file yet — start empty.
  }
}

function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify([...users.values()], null, 2));
}

function signToken(user) {
  return jwt.sign({ name: user.name, color: user.color }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

loadUsers();

// --- realtime fan-out -------------------------------------------------------
const clients = new Set();

function broadcast(obj) {
  const payload = JSON.stringify(obj);
  for (const c of clients) {
    if (c.readyState === c.OPEN) c.send(payload);
  }
}

function onlineUsers() {
  return [...clients]
    .filter((c) => c.username)
    .map((c) => ({ name: c.username, color: c.userColor }));
}

function sendPresence() {
  const list = onlineUsers();
  broadcast({ type: "presence", online: list.length, users: list });
}

// --- HTTP (auth) ------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

function readCredentials(req) {
  const name = String(req.body?.name ?? "").trim().slice(0, 20);
  const password = String(req.body?.password ?? "");
  return { name, password };
}

// hash the password, store the user, return a token
app.post("/api/register", async (req, res) => {
  const { name, password } = readCredentials(req);
  if (!name) return res.status(400).json({ error: "Name is required." });
  if (password.length < 4) {
    return res.status(400).json({ error: "Password must be at least 4 characters." });
  }
  if (users.has(name.toLowerCase())) {
    return res.status(409).json({ error: "That name is already taken." });
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = { name, color: colorFor(name), passwordHash };
  users.set(name.toLowerCase(), user);
  saveUsers();

  res.status(201).json({
    token: signToken(user),
    user: { name: user.name, color: user.color },
  });
});

// same 401 for unknown user and wrong password so we don't leak which names exist
app.post("/api/login", async (req, res) => {
  const { name, password } = readCredentials(req);
  if (!name || !password) {
    return res.status(400).json({ error: "Name and password are required." });
  }

  const user = users.get(name.toLowerCase());
  const ok = user && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) {
    return res.status(401).json({ error: "Invalid name or password." });
  }

  res.json({
    token: signToken(user),
    user: { name: user.name, color: user.color },
  });
});

// In dev the client runs under Vite; in prod we serve the build from here so
// everything is one origin.
const clientDist = path.join(__dirname, "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
  console.log(`Serving client build from ${clientDist}`);
}

const server = http.createServer(app);

// --- WebSocket (realtime) ---------------------------------------------------
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  // token comes in on the handshake query string
  const url = new URL(req.url, "http://localhost");
  const token = url.searchParams.get("token");

  let claims;
  try {
    claims = jwt.verify(token, JWT_SECRET);
  } catch {
    ws.close(4001, "invalid or missing token");
    return;
  }

  ws.username = claims.name;
  ws.userColor = claims.color;
  clients.add(ws);

  // send current board state to the new client
  ws.send(
    JSON.stringify({
      type: "init",
      columns: COLUMNS,
      cards,
      voteBudget: VOTE_BUDGET,
      you: { name: ws.username, color: ws.userColor },
    })
  );

  sendPresence();

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case "add_card": {
        const columnId = msg.columnId;
        const text = String(msg.text ?? "").trim().slice(0, MAX_CARD_LEN);
        if (!COLUMN_IDS.has(columnId) || !text) return;

        const card = {
          id: crypto.randomUUID(),
          columnId,
          text,
          author: ws.username,
          authorColor: ws.userColor,
          voters: [],
        };
        cards.push(card);
        broadcast({ type: "card_added", card });
        break;
      }

      case "delete_card": {
        const card = cards.find((c) => c.id === msg.id);
        if (!card) return;
        if (card.author !== ws.username) return; // only the author can delete
        cards = cards.filter((c) => c.id !== msg.id);
        broadcast({ type: "card_deleted", id: msg.id });
        break;
      }

      case "vote": {
        const card = cards.find((c) => c.id === msg.id);
        if (!card) return;

        const already = card.voters.includes(ws.username);
        if (already) {
          card.voters = card.voters.filter((n) => n !== ws.username); // toggle off
        } else {
          if (votesUsedBy(ws.username) >= VOTE_BUDGET) {
            ws.send(JSON.stringify({ type: "vote_denied", budget: VOTE_BUDGET }));
            return;
          }
          card.voters.push(ws.username);
        }
        broadcast({ type: "card_voted", id: card.id, voters: card.voters });
        break;
      }
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    sendPresence();
  });
});

server.listen(PORT, () => {
  console.log(`Retro Board server on http://localhost:${PORT}`);
  console.log(`  HTTP : POST /api/register  { name, password }`);
  console.log(`  HTTP : POST /api/login     { name, password }`);
  console.log(`  WS   : ws://localhost:${PORT}/ws?token=<jwt>`);
  console.log(`  Vote budget per user: ${VOTE_BUDGET}`);
});
