// Signing in: Cloudflare Access guards /signin and hands over a signed JWT saying who signed in.
// The Worker checks it and gives the app its own sync token, which doesn't expire; changing
// TOKEN_SECRET signs every device out.

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer | Uint8Array) {
  let text = "";
  for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function hmac(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** The token every signed-in device uses. */
export async function syncToken(secret: string) {
  return `v1.${base64url(await hmac(secret, "italian-sync v1"))}`;
}

export async function tokenValid(token: string | null, secret: string) {
  if (!token || !secret) return false;
  const expected = await syncToken(secret);
  if (token.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < token.length; index += 1) difference |= token.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export function bearer(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

type Jwk = JsonWebKey & { kid: string };
let certs: { keys: Jwk[]; fetchedAt: number } | null = null;

async function accessKeys(teamDomain: string, kid: string) {
  if (!certs || Date.now() - certs.fetchedAt > 3_600_000 || !certs.keys.some((key) => key.kid === kid)) {
    const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
    certs = { keys: ((await response.json()) as { keys: Jwk[] }).keys, fetchedAt: Date.now() };
  }
  return certs.keys;
}

/** The email Cloudflare Access signed in, if the JWT it sent is genuine, current, and for this app. */
export async function accessEmail(jwt: string | null, teamDomain: string, audience: string, keys?: Jwk[]): Promise<string | null> {
  if (!jwt || !audience) return null;
  const [headerPart, payloadPart, signaturePart] = jwt.split(".");
  if (!headerPart || !payloadPart || !signaturePart) return null;
  const header = JSON.parse(new TextDecoder().decode(fromBase64url(headerPart))) as { kid?: string; alg?: string };
  if (header.alg !== "RS256" || !header.kid) return null;
  const jwk = (keys ?? await accessKeys(teamDomain, header.kid)).find((key) => key.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signed = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromBase64url(signaturePart), encoder.encode(`${headerPart}.${payloadPart}`));
  if (!signed) return null;
  const payload = JSON.parse(new TextDecoder().decode(fromBase64url(payloadPart))) as { aud?: string | string[]; exp?: number; iss?: string; email?: string };
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience)) return null;
  if (payload.iss !== `https://${teamDomain}`) return null;
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
  return payload.email ?? null;
}

/** The app address to send the token back to, if it's one of the app's. */
export function returnUrl(requested: string | null, appUrls: string) {
  if (!requested) return null;
  const allowed = appUrls.split(/\s+/).filter(Boolean);
  try {
    const url = new URL(requested);
    url.hash = "";
    return allowed.find((app) => url.href === app || url.href.startsWith(app)) ? url.href : null;
  } catch {
    return null;
  }
}

/** Origins the app is served from, for CORS. */
export function appOrigins(appUrls: string) {
  return appUrls.split(/\s+/).filter(Boolean).map((url) => new URL(url).origin);
}
