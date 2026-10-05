// The Italian sync server. It keeps one copy of the inventory with a version number; devices merge
// (web/src/storage/cloudSync.ts) and upload "only if you're still on version N". Cloudflare Access
// guards every path, and each request's Access JWT is checked here too.
//
//   GET  /signin?return=<app url>  after Access signs you in, sends the browser back to the app
//   GET  /inventory[?since=N]      { version, inventory }, or { version, unchanged: true } if still N
//   PUT  /inventory                { baseVersion, inventory } → { version }, or 409 with what's there
//   GET  /live                     a WebSocket that's sent { version } whenever the inventory changes
import { DurableObject } from "cloudflare:workers";
import { accessEmail, accessJwt, appOrigins, returnUrl, type Jwk } from "./auth.ts";

export interface Env {
  INVENTORY: DurableObjectNamespace<InventoryStore>;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ALLOWED_EMAIL: string;
  APP_URLS: string;
  /** Only for `wrangler dev`: the keys a local test signs its own Access JWTs with. */
  ACCESS_CERTS?: string;
}

export class InventoryStore extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answering pings doesn't wake the object, so idle connections cost nothing.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // A Durable Object handles one request at a time, so checking the version and writing can't interleave.
  async read() {
    return { version: (await this.ctx.storage.get<number>("version")) ?? 0, inventory: (await this.ctx.storage.get<string>("inventory")) ?? null };
  }

  async write(baseVersion: number, inventory: string) {
    const current = await this.read();
    if (current.version !== baseVersion) return { ok: false as const, ...current };
    const version = current.version + 1;
    await this.ctx.storage.put({ version, inventory });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(JSON.stringify({ version }));
      } catch {
        // A connection that's going away reconnects and syncs anyway.
      }
    }
    return { ok: true as const, version };
  }

  /** Takes a live connection; hibernation keeps it open without running anything. */
  async fetch() {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ version: (await this.ctx.storage.get<number>("version")) ?? 0 }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketClose(socket: WebSocket, code: number) {
    socket.close(code === 1005 ? 1000 : code, "closing");
  }
}

function cors(request: Request, env: Env, response: Response) {
  const origin = request.headers.get("origin");
  if (origin && appOrigins(env.APP_URLS).includes(origin)) {
    const headers = new Headers(response.headers);
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
    headers.set("vary", "origin");
    return new Response(response.body, { status: response.status, headers });
  }
  return response;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function signedIn(request: Request, env: Env) {
  const keys = env.ACCESS_CERTS ? (JSON.parse(env.ACCESS_CERTS) as { keys: Jwk[] }).keys : undefined;
  const email = await accessEmail(accessJwt(request)!, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD, keys);
  return Boolean(email && email.toLowerCase() === env.ALLOWED_EMAIL.toLowerCase());
}

const store = (env: Env) => env.INVENTORY.get(env.INVENTORY.idFromName("inventory"));

async function inventory(request: Request, env: Env, url: URL) {
  const show = (stored: { version: number; inventory: string | null }) => ({ version: stored.version, inventory: stored.inventory && JSON.parse(stored.inventory) });
  if (request.method === "GET") {
    const stored = await store(env).read();
    const since = url.searchParams.get("since");
    return json(since !== null && Number(since) === stored.version ? { version: stored.version, unchanged: true } : show(stored));
  }
  const body = await request.json() as { baseVersion: number; inventory: unknown };
  const written = await store(env).write(body.baseVersion, JSON.stringify(body.inventory));
  return written.ok ? json({ version: written.version }) : json(show(written), 409);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Access lets preflight requests through (they never carry its cookie); they only say what's allowed.
    if (request.method === "OPTIONS") {
      return cors(request, env, new Response(null, {
        status: 204,
        headers: { "access-control-allow-methods": "GET, PUT", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" },
      }));
    }
    if (!await signedIn(request, env)) return cors(request, env, new Response(null, { status: 403 }));
    if (url.pathname === "/signin") {
      // Only back to the app, so signing in can't be used to send someone elsewhere.
      const back = returnUrl(url.searchParams.get("return")!, env.APP_URLS);
      return back ? Response.redirect(`${back}#sync-signed-in`, 302) : new Response(null, { status: 403 });
    }
    if (url.pathname === "/live") {
      // Only the app's pages may open one, so another site can't ride on the Access cookie.
      if (!appOrigins(env.APP_URLS).includes(request.headers.get("origin")!)) return new Response(null, { status: 403 });
      return store(env).fetch(request);
    }
    if (url.pathname === "/inventory") return cors(request, env, await inventory(request, env, url));
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
