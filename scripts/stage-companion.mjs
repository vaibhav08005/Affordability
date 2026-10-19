import { cp, lstat, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const companionRoot = join(root, "companion");
const source = join(root, "dist");
const target = join(companionRoot, "dist");

await stat(join(source, "companion.js"));
if (!target.startsWith(companionRoot + sep)) throw new Error("Invalid companion staging path.");
const existing = await lstat(target).catch(() => null);
if (existing?.isSymbolicLink()) throw new Error("Companion staging path must not be a symbolic link.");
if (existing) await rm(target, { recursive: true, force: true });

await mkdir(join(target, "ofc"), { recursive: true });
await cp(join(source, "companion.js"), join(target, "companion.js"));
await cp(join(source, "adapters"), join(target, "adapters"), { recursive: true });
await cp(join(source, "domain"), join(target, "domain"), { recursive: true });
await cp(join(source, "ofc", "adapter-version.js"), join(target, "ofc", "adapter-version.js"));
console.log("Staged shared lender adapters for the companion.");
