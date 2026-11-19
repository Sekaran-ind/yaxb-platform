// Add real MiniLM vectors for command examples the fixture lacks (test/fixtures/command-embeddings.json),
// keeping every vector already there. Run after adding a command or a built-in journey
// (journeyCommands): `npm run build && node tools/add-command-embeddings.mjs`.
import { readFileSync, writeFileSync } from "node:fs";
import { pipeline } from "@huggingface/transformers";
import { EMBEDDING_MODELS } from "../dist/knowledge/semantic.js";
import { allCommands } from "../dist/commands/index.js";
import { kioskContent } from "../dist/content/index.js";

const file = new URL("../test/fixtures/command-embeddings.json", import.meta.url);
const fixture = JSON.parse(readFileSync(file, "utf8"));
const model = EMBEDDING_MODELS.minilm;
if (fixture.model !== model.id) throw new Error(`The fixture is for ${fixture.model}, not ${model.id}.`);
const missing = [...new Set(allCommands(kioskContent.journeys).flatMap((c) => c.examples))].filter((e) => !fixture.examples[e]);
if (!missing.length) {
  console.log("command embeddings: nothing missing");
  process.exit(0);
}
const extractor = await pipeline("feature-extraction", model.id, { dtype: model.dtype });
const vectors = (await extractor(missing, { pooling: model.pooling, normalize: true })).tolist();
missing.forEach((e, i) => (fixture.examples[e] = Buffer.from(new Float32Array(vectors[i]).buffer).toString("base64")));
writeFileSync(file, JSON.stringify(fixture));
console.log(`command embeddings: added ${missing.length}: ${missing.join(" | ")}`);
