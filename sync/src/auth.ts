// Cloudflare Access guards all of sync.guymichaely.com: it turns away anyone not signed in before a
// request reaches the Worker. Each request it lets through carries a signed JWT saying who signed
// in, which the Worker checks too, as Cloudflare recommends.

const encoder = new TextEncoder();

function fromBase64url(text: string) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

export type Jwk = JsonWebKey & { kid: string };
let certs: { team: string; keys: Jwk[]; fetchedAt: number } | null = null;

async function accessKeys(teamDomain: string, kid: string) {
  if (!certs || certs.team !== teamDomain || Date.now() - certs.fetchedAt > 3_600_000 || !certs.keys.some((key) => key.kid === kid)) {
    const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
    certs = { team: teamDomain, keys: ((await response.json()) as { keys: Jwk[] }).keys, fetchedAt: Date.now() };
  }
  return certs.keys;
}

/** The email Cloudflare Access signed in, if the JWT is genuine, current, and for this app. */
export async function accessEmail(jwt: string, teamDomain: string, audience: string, keys?: Jwk[]): Promise<string | null> {
  const [headerPart, payloadPart, signaturePart] = jwt.split(".") as [string, string, string];
  const header = JSON.parse(new TextDecoder().decode(fromBase64url(headerPart))) as { kid: string; alg: string };
  if (header.alg !== "RS256") return null;
  const jwk = (keys ?? await accessKeys(teamDomain, header.kid)).find((key) => key.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signed = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromBase64url(signaturePart), encoder.encode(`${headerPart}.${payloadPart}`));
  if (!signed) return null;
  const payload = JSON.parse(new TextDecoder().decode(fromBase64url(payloadPart))) as { aud: string[]; exp: number; iss: string; email: string };
  if (!payload.aud.includes(audience)) return null;
  if (payload.iss !== `https://${teamDomain}`) return null;
  if (payload.exp * 1000 < Date.now()) return null;
  return payload.email;
}

/** The JWT Access sent: its header, or its cookie (which is what a local test sets). */
export function accessJwt(request: Request) {
  const header = request.headers.get("cf-access-jwt-assertion");
  if (header) return header;
  const cookie = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get("cookie") ?? "");
  return cookie ? cookie[1]! : null;
}

/** The app address to send the browser back to after signing in, if it's one of the app's. */
export function returnUrl(requested: string, appUrls: string) {
  const url = new URL(requested);
  url.hash = "";
  return appUrls.split(/\s+/).some((app) => app && url.href.startsWith(app)) ? url.href : null;
}

/** Origins the app is served from, for CORS and for checking where a live connection comes from. */
export function appOrigins(appUrls: string) {
  return appUrls.split(/\s+/).filter(Boolean).map((url) => new URL(url).origin);
}
