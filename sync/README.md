# Italian sync server

A Cloudflare Worker at `https://sync.guymichaely.com` that keeps one copy of the inventory, so every device that signs in has the same words. The app works without it: signed out, or with the server unreachable, words stay in the browser and sync later.

## How syncing works

The server stores the inventory and a version number in one Durable Object (`InventoryStore`), which handles one request at a time, so a check and a write can't interleave.

- `GET /inventory[?since=N]` returns `{ version, inventory }` (`inventory` is null before the first upload), or just `{ version, unchanged: true }` when the server is still on version N, so most syncs download nothing.
- `PUT /inventory` with `{ baseVersion, inventory }` stores it only if the server is still at `baseVersion`, answering `{ version }`; otherwise 409 with what it has.
- `GET /live` is a WebSocket. It's sent `{ version }` on connecting and whenever the inventory changes. Hibernation keeps idle connections open without running anything; pings are answered without waking the object.

The merging happens in the app (`web/src/storage/cloudSync.ts`); the server only stores. Each device remembers the inventory as it last synced it and merges three ways (that, its words now, the server's) with the same merge windows use (`web/src/storage/merge.ts`), then uploads with the version it merged against. If another device synced in between, it merges again. The same word or rules changed differently on two devices pause sync until the app's conflict screen settles which to keep.

Each device chooses when it syncs (Settings, kept on the device): **Automatically** (after edits, and as other devices change things, through `/live`, with a five-minute backstop), **When I edit** (after edits, on opening, and on coming back), or **Manually** (only Sync now).

## Signing in

Cloudflare Access guards all of `sync.guymichaely.com`: the Access application "Italian sync" with the Cloudflare login method and one allow policy for `guymichaely@gmail.com`. A request without its sign-in never reaches the Worker. The Worker checks each request's Access JWT anyway (team keys, `ACCESS_AUD`, `ALLOWED_EMAIL`), as Cloudflare recommends; `workers.dev` and preview addresses are off, so there's no way around Access.

- Settings → **Sign in with Cloudflare** opens `/signin?return=<the app's address>`. Access signs you in and sets its cookie for `sync.guymichaely.com`; the Worker sends the browser back to the app with `#sync-signed-in`.
- The app is on `guymichaely.com`, the same site, so its requests and live connection send that cookie (`credentials: "include"`). The Worker allows the app's origins (`APP_URLS`) with credentials, and the live connection only from them.
- Access lets browser preflight requests through (they never carry the cookie); the Worker answers them.
- Sign-ins last 730 hours (about a month), set on the Access application. When one expires, requests are redirected to the login page; the app shows **Sign in again**. To sign every device out at once, revoke the sessions in Zero Trust (My Team → Users).

## Developing

## Developing

```sh
npm ci
npm run typecheck
npm test                 # sign-in and token checks
npx wrangler deploy      # needs `npx wrangler login` once
```

`scripts/e2e.mjs` tries sync with two browser contexts against `wrangler dev`. `scripts/dev-access.mjs` stands in for Access: a test key (`test/dev-access-key.json`, used nowhere real) signs Access-style JWTs, and `node scripts/dev-access.mjs vars` writes `.dev.vars` so the local Worker trusts it. The test sets the JWT as Access's cookie. Start an empty local server and a web dev server pointed at it:

```sh
node scripts/dev-access.mjs vars
rm -rf .wrangler/state && npx wrangler dev --port 8787
VITE_SYNC_URL=http://localhost:8787 npm --prefix ../web run dev -- --port 5392
PLAYWRIGHT=../extension/node_modules/playwright/index.mjs node scripts/e2e.mjs
```

It signs in on two devices, checks that words added on either show on the other on their own, that a device set to Manually waits for Sync now, that a word changed on both is settled on the conflict screen, and that signing out keeps the words.
