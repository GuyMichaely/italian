import test from "node:test";
import assert from "node:assert/strict";
import { returnUrl } from "../src/appUrls.ts";

test("signing in only returns to the app", () => {
  const apps = "https://guymichaely.com/italian/ http://localhost:5391/";
  assert.equal(returnUrl("https://guymichaely.com/italian/#settings", apps), "https://guymichaely.com/italian/");
  assert.equal(returnUrl("http://localhost:5391/", apps), "http://localhost:5391/");
  for (const bad of ["https://evil.example/italian/", "https://guymichaely.com/other/", "https://guymichaely.com/italian/../other/", "javascript:alert(1)"]) {
    assert.equal(returnUrl(bad, apps), null, String(bad));
  }
});
