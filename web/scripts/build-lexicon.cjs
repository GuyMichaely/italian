// Builds public/lexicon/ from kaikki.org's English-Wiktionary Italian extract. See docs/LEXICON.md.
// Usage: npm run lexicon -- path/to/kaikki.org-dictionary-Italian.jsonl.gz
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

const { LexiconBuilder, lexiconChunks } = require(path.join(__dirname, "..", ".test-dist", "lexicon", "extract.js"));
const { chunkFileName } = require(path.join(__dirname, "..", ".test-dist", "lexicon", "format.js"));

/** Chunks of about 30 KB (roughly 6 KB compressed): one small fetch per lookup. */
const targetChunkBytes = 30_000;

async function main() {
  const source = process.argv[2];
  if (!source) {
    console.error("Usage: npm run lexicon -- path/to/kaikki.org-dictionary-Italian.jsonl.gz");
    process.exit(1);
  }
  let input = fs.createReadStream(source);
  if (source.endsWith(".gz")) input = input.pipe(zlib.createGunzip());
  const builder = new LexiconBuilder();
  let lines = 0;
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    builder.add(JSON.parse(line));
    lines += 1;
    if (lines % 100_000 === 0) console.log(`${lines} entries read`);
  }
  const keyed = builder.finish();
  const built = new Date().toISOString().slice(0, 10);
  const { index, chunks } = lexiconChunks(keyed, targetChunkBytes, `English Wiktionary via kaikki.org, extracted ${built}`);

  const bodies = chunks.map((chunk) => JSON.stringify(chunk));
  const hash = crypto.createHash("sha256");
  for (const body of bodies) hash.update(body);
  const build = hash.digest("hex").slice(0, 12);

  // Chunks live in a folder named for their contents, so a cached index never pairs with newer chunks.
  const root = path.join(__dirname, "..", "public", "lexicon");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, build), { recursive: true });
  bodies.forEach((body, number) => fs.writeFileSync(path.join(root, build, chunkFileName(number)), body));
  fs.writeFileSync(path.join(root, "index.json"), JSON.stringify({ build, ...index }));
  fs.writeFileSync(
    path.join(root, "ATTRIBUTION.txt"),
    "These files are derived from English Wiktionary (https://en.wiktionary.org/), via the kaikki.org extract\n"
      + "(https://kaikki.org/dictionary/Italian/). Wiktionary text is available under the Creative Commons\n"
      + "Attribution-ShareAlike License (https://creativecommons.org/licenses/by-sa/4.0/); so are these files.\n",
  );

  const bytes = bodies.reduce((sum, body) => sum + Buffer.byteLength(body), 0);
  const records = keyed.reduce((sum, [, list]) => sum + list.length, 0);
  console.log(`${lines} entries → ${keyed.length} keys, ${records} records, ${chunks.length} chunks, ${(bytes / 1e6).toFixed(1)} MB`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
