import { defineConfig } from "vite";

// In development, /sync goes to the Worker running under `wrangler dev` (see worker/README.md).
export default defineConfig({
  server: { proxy: { "/sync": { target: "http://localhost:8787", ws: true } } },
});
