import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LenderId } from "../domain/contracts.js";

// Use the compiled adapters even when the development server runs through tsx.
// The packaged companion and deployed server both execute these exact files.
const compiledRoot = import.meta.url.endsWith(".ts") ? "../../dist/" : "../";
const adaptersDir = fileURLToPath(new URL(`${compiledRoot}adapters/`, import.meta.url));
const validationFile = fileURLToPath(new URL(`${compiledRoot}domain/validation.js`, import.meta.url));
let cachedVersion: Promise<string> | undefined;
const lenderVersions = new Map<LenderId, Promise<string>>();

export function adapterVersion(): Promise<string> {
  cachedVersion ??= calculateVersion([adaptersDir]);
  return cachedVersion;
}

export function lenderAdapterVersion(lender: LenderId): Promise<string> {
  let version = lenderVersions.get(lender);
  if (!version) {
    version = calculateVersion([
      join(adaptersDir, lender === "virgin_money" ? "virgin-money" : lender),
      join(adaptersDir, "shared"),
      join(adaptersDir, "types.js"),
      validationFile
    ]);
    lenderVersions.set(lender, version);
  }
  return version;
}

async function calculateVersion(paths: string[]): Promise<string> {
  const hash = createHash("sha256");
  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = `${prefix}${entry.name}`;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute, `${relative}/`);
      } else if (/\.(ts|js)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        hash.update(relative).update("\0").update(await readFile(absolute)).update("\0");
      }
    }
  }
  for (const source of paths.sort()) {
    const relative = source.startsWith(adaptersDir) ? source.slice(adaptersDir.length) : `domain/${source.split(/[\\/]/).at(-1)}`;
    if (/\.(ts|js)$/.test(source)) {
      hash.update(relative).update("\0").update(await readFile(source)).update("\0");
    } else {
      await visit(source, source === adaptersDir ? "" : `${relative}/`);
    }
  }
  return hash.digest("hex");
}
