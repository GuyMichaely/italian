// The Italian sync server. It keeps one copy of the inventory with a version number; devices merge
// (web/src/storage/cloudSync.ts) and upload "only if you're still on version N". Cloudflare Access
// guards every path (only its policy's account gets through), so nothing here checks who's asking.
//
//   GET  /signin?return=<app url>  after Access signs you in, sends the browser back to the app
//   GET  /inventory[?since=N]      { version, inventory }, or { version, unchanged: true } if still N
//   PUT  /inventory                { baseVersion, inventory } → { version }, or 409 with what's there
//   GET  /live                     a WebSocket that's sent { version } whenever the inventory changes
import { DurableObject } from "cloudflare:workers";
import { appOrigins, returnUrl } from "./appUrls.ts";
import { parseInventoryState } from "../../web/src/storage/inventoryState";

export interface Env {
  INVENTORY: DurableObjectNamespace<InventoryStore>;
  APP_URLS: string;
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

const store = (env: Env) => env.INVENTORY.get(env.INVENTORY.idFromName("inventory"));

async function handleInventory(request: Request, env: Env, url: URL) {
  const show = (stored: { version: number; inventory: string | null }) => ({ version: stored.version, inventory: stored.inventory && JSON.parse(stored.inventory) });
  if (request.method === "GET") {
    const stored = await store(env).read();
    const since = url.searchParams.get("since");
    return json(since !== null && Number(since) === stored.version ? { version: stored.version, unchanged: true } : show(stored));
  }
  const body = await request.json() as { baseVersion: unknown; inventory: unknown };
  // Whatever is sent, only an inventory the app can read is stored: the app's own checks decide.
  let inventory;
  try {
    if (!Number.isSafeInteger(body.baseVersion)) throw new Error("No version.");
    inventory = parseInventoryState(body.inventory, "The upload");
  } catch {
    return new Response(null, { status: 400 });
  }
  const written = await store(env).write(body.baseVersion as number, JSON.stringify(inventory));
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
    if (url.pathname === "/inventory") return cors(request, env, await handleInventory(request, env, url));
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
