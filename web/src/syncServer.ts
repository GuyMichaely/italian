/** The sync server: /sync on the app's own origin (worker/ in this repo; in development, Vite forwards it to `wrangler dev`). */
export const syncServerUrl = new URL("sync", document.baseURI).href;
