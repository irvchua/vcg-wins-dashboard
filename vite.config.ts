import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Local-only: forwards /api/* to scripts/local-api-server.mjs (see its header comment)
    // so plain `npm run dev` gets a working Tasks API without vercel dev's env-var and
    // SPA-fallback issues.
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});