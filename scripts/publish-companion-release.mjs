import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Storage } from "@google-cloud/storage";

const releaseDir = resolve(process.argv[2] ?? "companion/release");
const bucketName = process.env.OFC_UPDATE_BUCKET;
const prefix = (process.env.OFC_UPDATE_PREFIX || "open-filled-calculator").replace(/^\/+|\/+$/g, "");
if (!bucketName || !/^[a-z0-9][a-z0-9._-]{2,221}$/.test(bucketName)) {
  throw new Error("Set OFC_UPDATE_BUCKET to a valid Cloud Storage bucket name.");
}
if (!prefix || prefix.split("/").some((part) => !/^[a-zA-Z0-9._-]+$/.test(part) || part === "..")) {
  throw new Error("OFC_UPDATE_PREFIX must be a safe, nonempty object prefix.");
}

const names = (await readdir(releaseDir)).sort();
const metadata = names.filter((name) => /^latest(?:-[a-z0-9-]+)?\.yml$/.test(name));
const requiredMetadata = ["latest.yml", "latest-mac.yml", "latest-linux.yml"];
if (requiredMetadata.some((name) => !metadata.includes(name))) {
  throw new Error(`Release is missing update metadata: ${requiredMetadata.filter((name) => !metadata.includes(name)).join(", ")}.`);
}
const latest = await readFile(join(releaseDir, "latest.yml"), "utf8");
const version = /^version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$/m.exec(latest)?.[1];
if (!version) throw new Error("Windows update metadata has no valid version.");
const packages = names.filter((name) => name.includes(version) && /\.(?:exe|dmg|zip|AppImage|deb|blockmap)$/.test(name));
for (const name of metadata) {
  const content = await readFile(join(releaseDir, name), "utf8");
  const metadataVersion = /^version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$/m.exec(content)?.[1];
  if (metadataVersion !== version) throw new Error(`${name} has a different release version.`);
  const references = [...content.matchAll(/^\s*(?:url|path):\s*['"]?([^'"\r\n]+)['"]?\s*$/gm)]
    .map((match) => basename(match[1].trim()));
  for (const reference of references) {
    if (!packages.includes(reference)) throw new Error(`${name} references missing package ${reference}.`);
  }
}
const installers = {
  "Open-Filled-Calculator-Windows.exe": packages.find((name) => name.endsWith(".exe")),
  "Open-Filled-Calculator-macOS.dmg": packages.find((name) => name.endsWith(".dmg")),
  "Open-Filled-Calculator-Linux.AppImage": packages.find((name) => name.endsWith(".AppImage"))
};
if (Object.values(installers).some((name) => !name)) {
  throw new Error("Release is missing a Windows, macOS, or Linux installer.");
}

const bucket = new Storage().bucket(bucketName);
async function upload(name, cacheControl) {
  const object = bucket.file(`${prefix}/${name}`);
  await bucket.upload(join(releaseDir, name), {
    destination: object,
    metadata: { cacheControl },
    validation: "crc32c"
  });
  console.log(`Published ${name}`);
}

// Publish binaries first. A client must never see metadata that points to a missing binary.
for (const name of packages) await upload(name, "public, max-age=31536000, immutable");
for (const [alias, source] of Object.entries(installers)) {
  await bucket.upload(join(releaseDir, source), {
    destination: `${prefix}/${alias}`,
    metadata: { cacheControl: "no-store" },
    validation: "crc32c"
  });
  console.log(`Published ${alias}`);
}
for (const name of metadata) await upload(name, "no-store");
console.log(`Update feed: https://storage.googleapis.com/${bucketName}/${prefix}/`);
