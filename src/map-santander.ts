import { readFile, writeFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { lenderReadyInputSchema } from "./domain/validation.js";
import { mapSantanderRawInput } from "./mappers/santander/raw-to-lender-ready.js";

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath) {
    throw new Error("Usage: tsx src/map-santander.ts <raw-input.yaml|json> [output-lender-ready.json]");
  }

  const rawText = await readFile(inputPath, "utf8");
  const rawInput = inputPath.toLowerCase().endsWith(".json") ? JSON.parse(rawText) : parseYaml(rawText);
  const result = mapSantanderRawInput(rawInput);
  const validated = lenderReadyInputSchema.parse(result.input);
  const payload = JSON.stringify(validated, null, 2);

  console.log("=== Santander final mapped output ===");
  console.log(payload);

  if (outputPath) {
    await writeFile(outputPath, `${payload}\n`, "utf8");
    console.log(`=== Santander mapped output written to ${outputPath} ===`);
  }

  if (result.issues.length > 0) {
    console.log("=== Santander mapping issues ===");
    console.log(JSON.stringify(result.issues, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
