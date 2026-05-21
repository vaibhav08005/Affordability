import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const samplesDir = join(rootDir, "samples");
const cliPath = join(rootDir, "dist", "cli.js");

const sampleFiles = (await readdir(samplesDir))
  .filter((file) => file.toLowerCase().endsWith(".json"))
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

if (sampleFiles.length === 0) {
  console.error("No JSON sample files found in samples/.");
  process.exitCode = 1;
} else {
  let failures = 0;

  for (const file of sampleFiles) {
    const samplePath = join(samplesDir, file);
    console.log(`\n=== ${file} ===`);
    const result = await runNode([cliPath, samplePath]);
    if (result.exitCode !== 0) {
      failures += 1;
      console.error(`Sample failed with exit code ${result.exitCode}: ${file}`);
      continue;
    }

    const sampleResult = parseJsonResult(result.stdout);
    if (sampleResult?.status === "failed") {
      failures += 1;
      console.error(`Sample returned failed status: ${file}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} sample run(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log(`\nCompleted ${sampleFiles.length} sample run(s).`);
  }
}

function runNode(args) {
  return new Promise((resolve) => {
    let stdout = "";
    const child = spawn(process.execPath, args, {
      cwd: rootDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout }));
  });
}

function parseJsonResult(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}
