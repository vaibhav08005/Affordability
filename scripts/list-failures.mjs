import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2] ?? "artifacts/failures";
const limit = Number(process.argv[3] ?? 20);

const failures = [];

for (const lender of await safeReaddir(root)) {
  const lenderPath = join(root, lender.name);
  if (!lender.isDirectory()) continue;

  for (const folder of await safeReaddir(lenderPath)) {
    if (!folder.isDirectory()) continue;
    const folderPath = join(lenderPath, folder.name);
    const failurePath = join(folderPath, "failure.json");
    const info = await readFailure(failurePath);
    const folderStat = await stat(folderPath).catch(() => null);
    failures.push({
      lender: info?.lender ?? lender.name,
      category: info?.category ?? "unknown",
      message: compact(info?.message ?? "No failure.json message"),
      folder: folderPath,
      modified: folderStat?.mtimeMs ?? 0
    });
  }
}

failures
  .sort((left, right) => right.modified - left.modified)
  .slice(0, limit)
  .forEach((failure, index) => {
    console.log(`${index + 1}. ${failure.lender} [${failure.category}]`);
    console.log(`   ${failure.message}`);
    console.log(`   ${failure.folder}`);
  });

if (failures.length === 0) {
  console.log(`No failure bundles found in ${root}`);
}

async function safeReaddir(path) {
  return readdir(path, { withFileTypes: true }).catch(() => []);
}

async function readFailure(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function compact(value) {
  return String(value).replace(/\s+/g, " ").slice(0, 180);
}
