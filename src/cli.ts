import { readFile } from "node:fs/promises";
import { runAffordabilityAutomation } from "./service.js";
import { loadRunContext } from "./config.js";

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Usage: npm run dev -- <path-to-lender-ready-json>");
  }

  const raw = await readFile(inputPath, "utf8");
  const input = JSON.parse(raw);
  const result = await runAffordabilityAutomation(input, loadRunContext());
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
