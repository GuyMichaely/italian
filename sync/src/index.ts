// The Italian sync server. It keeps one copy of the inventory with a version number; devices merge
// (web/src/storage/cloudSync.ts) and upload "only if you're still on version N".
//
//   GET  /signin?return=<app url>  behind Cloudflare Access: sends the browser back to the app
//                                  with a sync token in the address (#sync-token=…)
//   GET  /inventory                { version, inventory }   (inventory is null before the first upload)
//   PUT  /inventory                { baseVersion, inventory } → { version }, or 409 with what's there
import { DurableObject } from "cloudflare:workers";
import { accessEmail, appOrigins, bearer, returnUrl, syncToken, tokenValid } from "./auth.ts";

export interface Env {
  INVENTORY: DurableObjectNamespace<InventoryStore>;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ALLOWED_EMAIL: string;
  APP_URLS: string;
  TOKEN_SECRET: string;
}

/** Inventories can grow; this is far above any real one and keeps a mistake from filling storage. */
const maxInventoryBytes = 5_000_000;

export class InventoryStore extends DurableObject<Env> {
  // A Durable Object handles one request at a time, so checking the version and writing can't interleave.
  async read() {
    return { version: (await this.ctx.storage.get<number>("version")) ?? 0, inventory: (await this.ctx.storage.get<string>("inventory")) ?? null };
  }

  async write(baseVersion: number, inventory: string) {
    const current = await this.read();
    if (current.version !== baseVersion) return { ok: false as const, ...current };
    const version = current.version + 1;
    await this.ctx.storage.put({ version, inventory });
    return { ok: true as const, version };
  }
}

function cors(request: Request, env: Env, response: Response) {
  const origin = request.headers.get("origin");
  if (origin && appOrigins(env.APP_URLS).includes(origin)) {
    response.headers.set("access-control-allow-origin", origin);
    response.headers.set("vary", "origin");
  }
  return response;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function page(message: string, status: number) {
  return new Response(`<!doctype html><meta charset="utf-8"><title>Italian sync</title><p style="font:16px system-ui;margin:2em">${message}</p>`, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

async function signIn(request: Request, env: Env, url: URL) {
  const back = returnUrl(url.searchParams.get("return"), env.APP_URLS);
  if (!back) return page("Open this from the Italian app’s Settings.", 400);
  const email = await accessEmail(request.headers.get("cf-access-jwt-assertion"), env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
  if (!email || email.toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase()) return page("This account can’t sync with Italian.", 403);
  return Response.redirect(`${back}#sync-token=${encodeURIComponent(await syncToken(env.TOKEN_SECRET))}`, 302);
}

async function inventory(request: Request, env: Env) {
  if (!await tokenValid(bearer(request), env.TOKEN_SECRET)) return json({ error: "Sign in to sync." }, 401);
  const store = env.INVENTORY.get(env.INVENTORY.idFromName("inventory"));
  const show = (stored: { version: number; inventory: string | null }) => ({ version: stored.version, inventory: stored.inventory && JSON.parse(stored.inventory) });
  if (request.method === "GET") return json(show(await store.read()));
  if (request.method !== "PUT") return json({ error: "Use GET or PUT." }, 405);
  const text = await request.text();
  if (text.length > maxInventoryBytes) return json({ error: "That inventory is too large." }, 413);
  const body = JSON.parse(text) as { baseVersion?: unknown; inventory?: unknown };
  if (typeof body.baseVersion !== "number" || !body.inventory || typeof body.inventory !== "object") return json({ error: "Send { baseVersion, inventory }." }, 400);
  const written = await store.write(body.baseVersion, JSON.stringify(body.inventory));
  return written.ok ? json({ version: written.version }) : json(show(written), 409);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return cors(request, env, new Response(null, {
        status: 204,
        headers: { "access-control-allow-methods": "GET, PUT", "access-control-allow-headers": "authorization, content-type", "access-control-max-age": "86400" },
      }));
    }
    if (url.pathname === "/signin") return signIn(request, env, url);
    if (url.pathname === "/inventory") return cors(request, env, await inventory(request, env));
    return page("Italian sync server.", 404);
  },
} satisfies ExportedHandler<Env>;
