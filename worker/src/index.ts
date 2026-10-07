// The Italian app's server at italian.guymichaely.com. The app's files are served as static assets;
// this runs only for /sync, the sync server. It keeps one copy of the inventory with a version
// number; devices merge (web/src/storage/cloudSync.ts) and upload "only if you're still on version
// N". Cloudflare Access guards /sync (only its policy's account gets through), so nothing here checks
// who's asking. The app and /sync share one origin, so there's no CORS.
//
//   GET  /sync/signin                after Access signs you in, sends the browser back to the app
//   GET  /sync/inventory[?since=N]   { version, inventory }, or { version, unchanged: true } if still N
//   PUT  /sync/inventory             { baseVersion, inventory } → { version }, or 409 with what's there
//   GET  /sync/live                  a WebSocket that's sent { version } whenever the inventory changes
import { DurableObject } from "cloudflare:workers";
import { parseInventoryState } from "../../web/src/storage/inventoryState";

export interface Env {
  INVENTORY: DurableObjectNamespace<InventoryStore>;
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

// Back to the app from signing in (on whichever origin this was reached from), by a page rather than
// a redirect: an app in a WebView (Capacitor) loads pages itself and follows redirects without
// moving the address, which would stay here. The app turned syncing on before it came here, so it
// just syncs on opening.
const signedIn = `<!doctype html><meta charset="utf-8"><title>Signed in</title><script>location.replace("/")</script>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/sync/signin":
        return new Response(signedIn, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      case "/sync/live":
        return store(env).fetch(request);
      case "/sync/inventory":
        return handleInventory(request, env, url);
      default:
        return new Response(null, { status: 404 });
    }
  },
} satisfies ExportedHandler<Env>;
