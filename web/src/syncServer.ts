/** The sync server (sync/ in this repo). VITE_SYNC_URL points a dev build at `wrangler dev`. */
export const syncServerUrl = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env.VITE_SYNC_URL || "https://sync.guymichaely.com";
