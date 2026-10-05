// Stands in for Cloudflare Access when trying the Worker locally: a fixed test key (not used
// anywhere real) signs Access-style JWTs, and `wrangler dev` is told to trust it.
//   node scripts/dev-access.mjs vars   writes .dev.vars for `wrangler dev`
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const privateKey = JSON.parse(readFileSync(path.join(root, "test/dev-access-key.json"), "utf8"));
export const devTeam = "dev.test";
export const devAudience = "dev";
export const devAppUrl = "http://localhost:5392/";

/** A JWT like the one Access passes on, for `email`. */
export async function devAccessJwt(email = "guymichaely@gmail.com") {
  const key = await crypto.subtle.importKey("jwk", privateKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", kid: privateKey.kid })}.${encode({ aud: [devAudience], iss: `https://${devTeam}`, email, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${Buffer.from(signature).toString("base64url")}`;
}

if (process.argv[2] === "vars") {
  const { d, p, q, dp, dq, qi, ...publicKey } = privateKey;
  writeFileSync(path.join(root, ".dev.vars"), [
    `ACCESS_TEAM_DOMAIN=${devTeam}`,
    `ACCESS_AUD=${devAudience}`,
    `ACCESS_CERTS=${JSON.stringify({ keys: [{ ...publicKey, key_ops: ["verify"] }] })}`,
    `APP_URLS=${devAppUrl}`,
    "",
  ].join("\n"));
  console.log("Wrote .dev.vars");
}
