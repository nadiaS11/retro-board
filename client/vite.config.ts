import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /api to the auth server so the client can use same-origin fetch.
// The WebSocket connects directly to the server (see src/store.ts).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
