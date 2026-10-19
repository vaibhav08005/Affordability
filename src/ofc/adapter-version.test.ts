import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test, type TestContext } from "node:test";
import { calculateAdapterVersion } from "./adapter-version.js";

async function fixture(context: TestContext, newline: string) {
  const root = await mkdtemp(join(tmpdir(), "ofc-version-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const adapters = join(root, "adapters") + sep;
  await mkdir(join(adapters, "halifax"), { recursive: true });
  await mkdir(join(adapters, "shared"));
  await mkdir(join(root, "domain"));
  const files = {
    [join(adapters, "halifax", "adapter.js")]: "export const lender = 'halifax';\n",
    [join(adapters, "shared", "browser.js")]: "export const script = `first line\nsecond line`;\n",
    [join(adapters, "types.js")]: "export {};\n",
    [join(root, "domain", "validation.js")]: "export const valid = true;\n"
  };
  for (const [file, source] of Object.entries(files)) {
    await writeFile(file, source.replace(/\n/g, newline));
  }
  return {
    adapters,
    lenderFiles: [join(adapters, "halifax"), join(adapters, "shared"), join(adapters, "types.js"), join(root, "domain", "validation.js")]
  };
}

test("OFC fingerprints match across LF and CRLF builds", async (context) => {
  const lf = await fixture(context, "\n");
  const crlf = await fixture(context, "\r\n");
  assert.equal(
    await calculateAdapterVersion([lf.adapters], lf.adapters),
    await calculateAdapterVersion([crlf.adapters], crlf.adapters)
  );
  assert.equal(
    await calculateAdapterVersion(lf.lenderFiles, lf.adapters),
    await calculateAdapterVersion(crlf.lenderFiles, crlf.adapters)
  );
});

test("OFC fingerprints still detect adapter and validation changes", async (context) => {
  const source = await fixture(context, "\n");
  const before = await calculateAdapterVersion(source.lenderFiles, source.adapters);
  await writeFile(join(source.adapters, "halifax", "adapter.js"), "export const lender = 'changed';\n");
  const adapterChanged = await calculateAdapterVersion(source.lenderFiles, source.adapters);
  assert.notEqual(adapterChanged, before);
  await writeFile(source.lenderFiles.at(-1)!, "export const valid = false;\n");
  assert.notEqual(await calculateAdapterVersion(source.lenderFiles, source.adapters), adapterChanged);
});
