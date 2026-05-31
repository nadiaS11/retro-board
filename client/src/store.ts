import { create } from "zustand";

// dev: WS server is on 8787. prod: same origin as the page (wss on https).
function wsUrl(token: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const host = import.meta.env.DEV ? `${location.hostname}:8787` : location.host;
  return `${proto}://${host}/ws?token=${encodeURIComponent(token)}`;
}

export type User = { name: string; color: string };
export type Status = "idle" | "connecting" | "open" | "closed" | "error";
export type Column = { id: string; title: string };
export type Card = {
  id: string;
  columnId: string;
  text: string;
  author: string;
  authorColor: string;
  voters: string[];
};

type ServerMessage =
  | {
      type: "init";
      columns: Column[];
      cards: Card[];
      voteBudget: number;
      you: User;
    }
  | { type: "card_added"; card: Card }
  | { type: "card_deleted"; id: string }
  | { type: "card_voted"; id: string; voters: string[] }
  | { type: "presence"; online: number; users: User[] }
  | { type: "vote_denied"; budget: number };

interface RetroState {
  // auth
  token: string | null;
  user: User | null;
  // connection
  status: Status;
  error: string | null;
  // board
  columns: Column[];
  cards: Card[];
  voteBudget: number;
  // session
  online: number;
  users: User[];
  notice: string | null;

  // actions
  authenticate: (
    mode: "login" | "register",
    name: string,
    password: string
  ) => Promise<void>;
  addCard: (columnId: string, text: string) => void;
  deleteCard: (id: string) => void;
  toggleVote: (id: string) => void;
  logout: () => void;
}

// kept outside the store — not serialisable, and shouldn't trigger re-renders
let socket: WebSocket | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function send(msg: object) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

export const useRetro = create<RetroState>((set, get) => ({
  token: null,
  user: null,
  status: "idle",
  error: null,
  columns: [],
  cards: [],
  voteBudget: 0,
  online: 0,
  users: [],
  notice: null,

  authenticate: async (mode, name, password) => {
    set({ status: "connecting", error: null });
    try {
      const res = await fetch(`/api/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Authentication failed");
      }
      const { token, user } = (await res.json()) as {
        token: string;
        user: User;
      };
      set({ token, user });

      // token goes on the query string; server verifies it on the handshake
      socket = new WebSocket(wsUrl(token));

      socket.onopen = () => set({ status: "open" });

      socket.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMessage;
        switch (msg.type) {
          case "init":
            set({
              columns: msg.columns,
              cards: msg.cards,
              voteBudget: msg.voteBudget,
            });
            break;
          case "card_added":
            set({ cards: [...get().cards, msg.card] });
            break;
          case "card_deleted":
            set({ cards: get().cards.filter((c) => c.id !== msg.id) });
            break;
          case "card_voted":
            set({
              cards: get().cards.map((c) =>
                c.id === msg.id ? { ...c, voters: msg.voters } : c
              ),
            });
            break;
          case "presence":
            set({ online: msg.online, users: msg.users });
            break;
          case "vote_denied": {
            set({ notice: `You've used all ${msg.budget} of your votes.` });
            if (noticeTimer) clearTimeout(noticeTimer);
            noticeTimer = setTimeout(() => set({ notice: null }), 2600);
            break;
          }
        }
      };

      socket.onerror = () => set({ status: "error", error: "Connection error" });
      socket.onclose = () => set({ status: "closed" });
    } catch (err) {
      set({
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  addCard: (columnId, text) => {
    const trimmed = text.trim();
    if (trimmed) send({ type: "add_card", columnId, text: trimmed });
  },

  deleteCard: (id) => send({ type: "delete_card", id }),

  toggleVote: (id) => send({ type: "vote", id }),

  logout: () => {
    socket?.close();
    socket = null;
    set({
      token: null,
      user: null,
      status: "idle",
      cards: [],
      columns: [],
      users: [],
      online: 0,
      notice: null,
    });
  },
}));

// how many votes the current user has spent
export function votesUsed(state: RetroState): number {
  const me = state.user?.name;
  if (!me) return 0;
  return state.cards.reduce((n, c) => n + (c.voters.includes(me) ? 1 : 0), 0);
}
