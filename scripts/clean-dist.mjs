import { existsSync, lstatSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";

const workspace = realpathSync(process.cwd());
const target = path.resolve(workspace, "dist");
if (path.dirname(target) !== workspace) throw new Error("Build output is outside the workspace.");
if (existsSync(target)) {
  if (lstatSync(target).isSymbolicLink() || !realpathSync(target).startsWith(`${workspace}${path.sep}`)) {
    throw new Error("Build output does not resolve inside the workspace.");
  }
  rmSync(target, { recursive: true, force: true });
}
