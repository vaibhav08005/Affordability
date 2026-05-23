import { readFile, writeFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { lenderReadyInputSchema } from "./domain/validation.js";
import { mapBarclaysRawInput } from "./mappers/barclays/raw-to-lender-ready.js";

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath) {
    throw new Error("Usage: tsx src/map-barclays.ts <raw-input.yaml|json> [output-lender-ready.json]");
  }

  const rawText = await readFile(inputPath, "utf8");
  const rawInput = inputPath.toLowerCase().endsWith(".json") ? JSON.parse(rawText) : parseYaml(rawText);
  const result = mapBarclaysRawInput(rawInput);
  const validated = lenderReadyInputSchema.parse(result.input);
  const payload = JSON.stringify(validated, null, 2);

  console.log("=== Barclays final mapped output ===");
  console.log(payload);

  if (outputPath) {
    await writeFile(outputPath, `${payload}\n`, "utf8");
    console.log(`=== Barclays mapped output written to ${outputPath} ===`);
  }

  if (result.issues.length > 0) {
    console.log("=== Barclays mapping issues ===");
    console.log(JSON.stringify(result.issues, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
