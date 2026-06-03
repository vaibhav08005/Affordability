import { Storage } from "@google-cloud/storage";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { AffordabilityResult } from "../domain/contracts.js";

const storage = new Storage();

export async function uploadResultArtifacts(result: AffordabilityResult, runId: string, caseId: string): Promise<AffordabilityResult> {
  const bucketName = process.env.EVIDENCE_BUCKET;
  if (!bucketName) return result;

  const evidence = { ...result.evidence };
  const basePrefix = objectPrefix(runId, caseId, result.lender);

  evidence.screenshotUri = result.evidence.screenshotPath
    ? await uploadFile(bucketName, result.evidence.screenshotPath, `${basePrefix}/screenshot.png`)
    : result.evidence.screenshotUri;

  evidence.screenshotUris = result.evidence.screenshotPaths?.length
    ? (await Promise.all(result.evidence.screenshotPaths.map((filePath, index) => uploadFile(bucketName, filePath, `${basePrefix}/screenshots/${index + 1}.png`))))
        .filter((uri): uri is string => Boolean(uri))
    : result.evidence.screenshotUris;

  evidence.pdfUri = result.evidence.pdfPath
    ? await uploadFile(bucketName, result.evidence.pdfPath, `${basePrefix}/evidence.pdf`)
    : result.evidence.pdfUri;

  evidence.failureBundleUri = result.evidence.failureBundlePath
    ? await uploadDirectory(bucketName, result.evidence.failureBundlePath, `${basePrefix}/failure`)
    : result.evidence.failureBundleUri;

  return {
    ...result,
    evidence
  };
}

export interface StorageUriParts {
  bucketName: string;
  objectName: string;
}

export function parseStorageUri(uri: string): StorageUriParts | null {
  if (!uri.startsWith("gs://")) return null;
  const withoutScheme = uri.slice("gs://".length);
  const separatorIndex = withoutScheme.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === withoutScheme.length - 1) return null;

  return {
    bucketName: withoutScheme.slice(0, separatorIndex),
    objectName: withoutScheme.slice(separatorIndex + 1)
  };
}

export function createArtifactReadStream(uri: string): NodeJS.ReadableStream | null {
  const parts = parseStorageUri(uri);
  if (!parts) return null;
  return storage.bucket(parts.bucketName).file(parts.objectName).createReadStream();
}

async function uploadFile(bucketName: string, localPath: string, objectName: string): Promise<string | undefined> {
  if (!await fileExists(localPath)) return undefined;
  await storage.bucket(bucketName).upload(localPath, {
    destination: objectName,
    resumable: false,
    metadata: {
      cacheControl: "private, max-age=0"
    }
  });
  return `gs://${bucketName}/${objectName}`;
}

async function uploadDirectory(bucketName: string, localDirectory: string, objectPrefix: string): Promise<string | undefined> {
  const directoryStat = await stat(localDirectory).catch(() => null);
  if (!directoryStat?.isDirectory()) return undefined;

  for (const filePath of await listFiles(localDirectory)) {
    const relativePath = path.relative(localDirectory, filePath).replace(/\\/g, "/");
    await uploadFile(bucketName, filePath, `${objectPrefix}/${relativePath}`);
  }

  return `gs://${bucketName}/${objectPrefix}/`;
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(entryPath);
    return entry.isFile() ? [entryPath] : [];
  }));
  return nested.flat();
}

async function fileExists(filePath: string): Promise<boolean> {
  return Boolean(await stat(filePath).then((fileStat) => fileStat.isFile()).catch(() => false));
}

function objectPrefix(runId: string, caseId: string, lender: string): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
  return `cases/${date}/${safeSegment(caseId)}/${safeSegment(runId)}/${safeSegment(lender)}`;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}
