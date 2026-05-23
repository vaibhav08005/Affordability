import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { lenderReadyInputSchema } from "../dist/domain/validation.js";
import { mapHsbcRawInput } from "../dist/mappers/hsbc/raw-to-lender-ready.js";

const inputDir = process.argv[2] ?? "samples/raw-halifax-cases";
const outputDir = process.argv[3] ?? "samples/hsbc-mapped-cases";

await mkdir(outputDir, { recursive: true });

const files = (await readdir(inputDir))
  .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml") || file.endsWith(".json"))
  .sort();

for (const file of files) {
  const sourcePath = join(inputDir, file);
  const rawText = await readFile(sourcePath, "utf8");
  const rawInput = file.endsWith(".json") ? JSON.parse(rawText) : parseYaml(rawText);
  const result = mapHsbcRawInput(rawInput);
  const validated = lenderReadyInputSchema.parse(result.input);
  const outputName = `${basename(file).replace(/^halifax-raw-/, "hsbc-raw-").replace(/\.(yaml|yml|json)$/i, "")}.json`;
  const outputPath = join(outputDir, outputName);
  const payload = JSON.stringify(validated, null, 2);
  await writeFile(outputPath, `${payload}\n`, "utf8");

  console.log(`${file} -> ${outputPath}`);
  console.log("=== HSBC final mapped output ===");
  console.log(payload);
  if (result.issues.length > 0) {
    console.log(JSON.stringify({ mappingIssues: result.issues }, null, 2));
  }
}

console.log(`Mapped ${files.length} HSBC raw case(s).`);
