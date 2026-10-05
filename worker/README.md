# Italian Worker

A Cloudflare Worker at `https://italian.guymichaely.com` that serves the Italian app and its sync server. The app's built files (`../web/dist`) are static assets; the Worker's code runs only for `/sync`, which keeps one copy of the inventory so every device that signs in has the same words. The app works without sync: signed out, or with the server unreachable, words stay in the browser and sync later.

The app and `/sync` share one origin, so there's no CORS. The app has its own subdomain, so its storage and server are separate from the other sites on guymichaely.com, which stay on GitHub Pages. Cloudflare issues and renews the certificate for `italian.guymichaely.com`.

## How syncing works

The server stores the inventory and a version number in one Durable Object (`InventoryStore`), which handles one request at a time, so a check and a write can't interleave. (The Worker is still named `italian-sync`, so the stored inventory carried over when it moved here.)

- `GET /sync/inventory[?since=N]` returns `{ version, inventory }` (`inventory` is null before the first upload), or just `{ version, unchanged: true }` when the server is still on version N, so most syncs download nothing.
- `PUT /sync/inventory` with `{ baseVersion, inventory }` stores it only if the server is still at `baseVersion`, answering `{ version }`; otherwise 409 with what it has. Only an inventory the app's own parser accepts is stored; anything else gets 400.
- `GET /sync/live` is a WebSocket. It's sent `{ version }` on connecting and whenever the inventory changes. Hibernation keeps idle connections open without running anything; pings are answered without waking the object.

The merging happens in the app (`web/src/storage/cloudSync.ts`); the server only stores. Each device remembers the inventory as it last synced it and merges three ways (that, its words now, the server's) with the same merge windows use (`web/src/storage/merge.ts`), then uploads with the version it merged against. If another device synced in between, it merges again. The same word or rules changed differently on two devices pause sync until the app's conflict screen settles which to keep.

Each device chooses when it syncs (Settings, kept on the device): **Automatically** (after edits, and as other devices change things, through `/sync/live`, with a five-minute backstop), **When I edit** (after edits, on opening, and on coming back), or **Manually** (only Sync now).

## Signing in

Cloudflare Access guards `italian.guymichaely.com/sync`: the Access application "Italian sync" with the Cloudflare login method and one allow policy for `guymichaely@gmail.com`. A request without that sign-in never reaches the Worker, so the Worker doesn't check who's asking. `workers.dev` and preview addresses are off, so there's no way around Access; keep it that way, and keep the policy to your account. The app itself is public.

- Settings → **Sign in with Cloudflare** opens `/sync/signin`. Access signs you in and sets its cookie; the Worker sends the browser back to the app with `#sync-signed-in`.
- Sign-ins last 730 hours (about a month), set on the Access application. When one expires, requests are redirected to the login page; the app shows **Sign in again**. To sign every device out at once, revoke the sessions in Zero Trust (My Team → Users).

## Deploying

`.github/workflows/deploy.yml` builds the app and deploys the Worker on every push to `main` that touches `web/` or `worker/`. It needs the repository secret `CLOUDFLARE_API_TOKEN`, a Cloudflare API token made from the "Edit Cloudflare Workers" template. From a machine where `npx wrangler login` has been run, `npm run deploy` does the same.

## Developing

```sh
npm ci
npm run typecheck
```

`scripts/e2e.mjs` tries sync with two browser contexts. The web dev server forwards `/sync` to `wrangler dev` (`../web/vite.config.ts`), which has no Access in front. Build the app once (`wrangler dev` serves `../web/dist` too), then start an empty local server and the web dev server:

```sh
npm --prefix ../web run build
rm -rf .wrangler/state && npx wrangler dev --port 8787
npm --prefix ../web run dev -- --port 5391
PLAYWRIGHT=../extension/node_modules/playwright/index.mjs node scripts/e2e.mjs
```

It signs in on two devices, checks that words added on either show on the other on their own, that a device set to Manually waits for Sync now, that a word changed on both is settled on the conflict screen, and that signing out keeps the words.
