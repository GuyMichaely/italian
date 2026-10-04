# Italian sync server

A Cloudflare Worker at `https://sync.guymichaely.com` that keeps one copy of the inventory, so every device that signs in has the same words. The app works without it: signed out, or with the server unreachable, words stay in the browser and sync later.

## How syncing works

The server stores the inventory and a version number in one Durable Object (`InventoryStore`). A Durable Object handles one request at a time, so a check and a write can't interleave.

- `GET /inventory` returns `{ version, inventory }`. `inventory` is null before the first upload.
- `PUT /inventory` takes `{ baseVersion, inventory }`. It stores the inventory only if the server is still at `baseVersion`, and answers `{ version }`. Otherwise it answers 409 with what it has.

The merging happens in the app (`web/src/storage/cloudSync.ts`). The server only stores.
- Each device remembers the inventory as it last synced it.
- A sync merges three ways: that copy, the device's words now, and the server's. This is the same merge (`web/src/storage/merge.ts`) the app uses between windows.
- After merging, the device uploads with the version it merged against. If another device synced in between, it merges again.
- When the same word, or the same rules, changed differently on two devices, sync pauses. The app's conflict screen then asks which version to keep.

## Signing in

Cloudflare Access guards only `/signin`:
- the Access application is "Italian sync sign-in", on `sync.guymichaely.com/signin`;
- the login method is Cloudflare;
- one allow policy admits `guymichaely@gmail.com`.

Settings → **Sign in with Cloudflare** opens `/signin?return=<the app's address>`. The flow then goes:
1. Access logs you in and passes the Worker a signed JWT.
2. The Worker checks that JWT against the team's keys, `ACCESS_AUD` and `ALLOWED_EMAIL`.
3. The Worker sends the browser back to the app with `#sync-token=…`.
4. The app keeps that token and sends it as `Authorization: Bearer` on every sync.

The return address must start with one of the addresses in `APP_URLS`.

The token doesn't expire. Every device gets the same token, an HMAC of a fixed string under `TOKEN_SECRET`. To sign every device out, change the secret:

```sh
node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))' | npx wrangler secret put TOKEN_SECRET
```

## Developing

```sh
npm ci
npm run typecheck
npm test                 # sign-in and token checks
npx wrangler deploy      # needs `npx wrangler login` once
```

`scripts/e2e.mjs` tries sync with two browser contexts. It runs against `wrangler dev`, with `TOKEN_SECRET=dev-secret` in `.dev.vars`, and a web dev server pointed at it:

```sh
npx wrangler dev --port 8787 --var APP_URLS:http://localhost:5392/
VITE_SYNC_URL=http://localhost:8787 npm --prefix ../web run dev -- --port 5392
```

The script covers:
- signing in;
- words added on two devices;
- a word changed on both and settled on the conflict screen;
- signing out.

It needs an empty local server, so delete `.wrangler/state` before starting `wrangler dev`:

```sh
PLAYWRIGHT=../extension/node_modules/playwright/index.mjs node scripts/e2e.mjs
```
