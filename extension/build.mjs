// Builds the extension into dist/. The app it talks to (and fetches the dictionary from) is
// https://guymichaely.com/italian/ unless --app gives another, e.g. --app http://localhost:5391/
// for trying it against the dev server. --tests bundles tests/ into .test-dist/ instead.
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const appFlag = args.indexOf("--app");
const appUrl = appFlag >= 0 ? new URL(args[appFlag + 1]).href : "https://guymichaely.com/italian/";
const production = appUrl === "https://guymichaely.com/italian/";
const define = { APP_URL: JSON.stringify(appUrl), DEV_BUILD: JSON.stringify(!production) };

if (args.includes("--tests")) {
  const outdir = path.join(root, ".test-dist");
  rmSync(outdir, { recursive: true, force: true });
  await build({
    entryPoints: readdirSync(path.join(root, "tests")).filter((file) => file.endsWith(".test.ts")).map((file) => path.join(root, "tests", file)),
    bundle: true,
    platform: "node",
    format: "esm",
    outdir,
    outExtension: { ".js": ".mjs" },
    define,
    logLevel: "warning",
  });
} else {
  const outdir = path.join(root, "dist");
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
  const common = { bundle: true, define, target: "chrome120", logLevel: "warning", legalComments: "none" };
  await build({ ...common, entryPoints: [path.join(root, "src/background.ts")], format: "esm", outfile: path.join(outdir, "background.js") });
  // Content scripts and the popup run as classic scripts.
  for (const name of ["bridge", "toast", "popup"]) {
    await build({ ...common, entryPoints: [path.join(root, `src/${name}.ts`)], format: "iife", outfile: path.join(outdir, `${name}.js`) });
  }
  cpSync(path.join(root, "src/popup.html"), path.join(outdir, "popup.html"));
  cpSync(path.join(root, "src/popup.css"), path.join(outdir, "popup.css"));

  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
  const appMatch = `${appUrl}*`;
  if (!production) {
    // A development build talks to another copy of the app. 127.0.0.1 is for test pages that
    // aren't the app (scripts/e2e.mjs).
    const devMatch = appMatch.replace(/:\d+\//, "/");
    manifest.name = `${manifest.name} (dev)`;
    manifest.host_permissions = [devMatch, "http://127.0.0.1/*"];
    manifest.content_scripts[0].matches = [devMatch];
    delete manifest.update_url;
  }
  writeFileSync(path.join(outdir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Built dist/ for ${appUrl}`);
}
