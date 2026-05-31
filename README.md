# RetroBoard

A real-time sprint retrospective board. Teammates join a shared board, add cards
under *What went well / What to improve / Action items*, and spend a limited
number of dot-votes to prioritise. Everything syncs live — no refresh.

**Stack:** React + Zustand (client), Express + `ws` (server), JWT auth with
bcryptjs-hashed passwords. Set up as a pnpm workspace.

## Running locally

```bash
pnpm install
```

Dev mode (two terminals, hot reload):

```bash
pnpm dev:server      # API + WS on :8787
pnpm dev:client      # Vite on :5173  ← open this
```

Single service (Node serves the built client too):

```bash
pnpm build
PORT=8787 pnpm start # open http://localhost:8787
```

Open two tabs with different accounts to run a retro with yourself.

## How votes work

Each person gets a fixed budget of dot-votes (default 5). The budget is enforced
on the server per account, not in the UI — so you can't spend more by tampering
with the client. Voting again on a card you've already voted for frees the vote.

## Deploy (Render)

One web service. In production the Node server serves the API, the WebSocket,
and the built React app on the same origin (the client upgrades to `wss://` over
HTTPS automatically), so there's no CORS or extra port to manage.

`render.yaml` is included — build is `pnpm install && pnpm build`, start is
`pnpm start`. If you deploy the parent repo instead, set the service's Root
Directory to `retro-board`.

On the free tier the dyno sleeps after ~15 min idle (cold start on next hit),
the board is in memory so it resets on restart, and `users.json` sits on an
ephemeral disk so accounts reset on redeploy. Fine for sharing a link; use a
volume or a DB if you want persistence.

## Known limits / next steps

- One shared board for everyone — scoping boards by room (`/r/sprint-42`) is the
  obvious next step.
- Accounts in a JSON file, cards in memory — both would move to a DB.
- `JWT_SECRET` defaults to a dev value; set a real one in production.
