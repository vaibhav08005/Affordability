import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const caseNumbers = [1, 3, 5, 7, 9, 11, 12, 13, 14, 15, 16];

for (const caseNumber of caseNumbers) {
  const sourcePath = join(rootDir, "samples", `test-case-${caseNumber}.json`);
  const targetPath = join(rootDir, "samples", "natwest", `test-case-${caseNumber}.json`);
  const sample = JSON.parse(await readFile(sourcePath, "utf8"));
  sample.lender = "natwest";

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(sample, null, 2)}\n`);
  console.log(`Created ${targetPath}`);
}
