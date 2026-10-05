import test from "node:test";
import assert from "node:assert/strict";
import { accessEmail, accessJwt, returnUrl } from "../src/auth.ts";

const team = "team.cloudflareaccess.com";
const audience = "aud-tag";
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function signer() {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "key-1" };
  const sign = async (payload: Record<string, unknown>) => {
    const unsigned = `${encode({ alg: "RS256", kid: "key-1" })}.${encode(payload)}`;
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(unsigned));
    return `${unsigned}.${Buffer.from(signature).toString("base64url")}`;
  };
  return { keys: [jwk], sign };
}

test("a genuine, current Access sign-in for this app gives its email", async () => {
  const { keys, sign } = await signer();
  const exp = Math.floor(Date.now() / 1000) + 600;
  const good = { aud: [audience], iss: `https://${team}`, exp, email: "me@example.com" };
  assert.equal(await accessEmail(await sign(good), team, audience, keys), "me@example.com");
  for (const bad of [{ ...good, aud: ["other"] }, { ...good, iss: "https://evil.example" }, { ...good, exp: 1 }]) {
    assert.equal(await accessEmail(await sign(bad), team, audience, keys), null);
  }
  const forged = (await sign(good)).replace(/\.[^.]+$/, `.${Buffer.from("nope").toString("base64url")}`);
  assert.equal(await accessEmail(forged, team, audience, keys), null);
  assert.equal(await accessEmail(null, team, audience, keys), null);
  assert.equal(await accessEmail("not.a.jwt", team, audience, keys), null);
});

test("the JWT comes from Access's header, or its cookie", () => {
  assert.equal(accessJwt(new Request("https://sync.test/", { headers: { "cf-access-jwt-assertion": "a.b.c" } })), "a.b.c");
  assert.equal(accessJwt(new Request("https://sync.test/", { headers: { cookie: "x=1; CF_Authorization=d.e.f" } })), "d.e.f");
  assert.equal(accessJwt(new Request("https://sync.test/")), null);
});

test("signing in only returns to the app", () => {
  const apps = "https://guymichaely.com/italian/ http://localhost:5391/";
  assert.equal(returnUrl("https://guymichaely.com/italian/#settings", apps), "https://guymichaely.com/italian/");
  assert.equal(returnUrl("http://localhost:5391/", apps), "http://localhost:5391/");
  for (const bad of ["https://evil.example/italian/", "https://guymichaely.com/other/", "https://guymichaely.com/italian/../other/", "javascript:alert(1)", null]) {
    assert.equal(returnUrl(bad, apps), null, String(bad));
  }
});
