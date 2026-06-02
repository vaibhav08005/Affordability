import { chromium, type Page } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunContext } from "../types.js";
import { captureEvidence } from "./browser.js";

export interface PageEvidence {
  title: string;
  path: string;
}

export async function capturePageEvidence(
  page: Page,
  context: RunContext,
  pageEvidence: PageEvidence[],
  lender: string,
  name: string
): Promise<void> {
  await page.waitForTimeout(300);
  const path = await captureEvidence(page, context, `${lender}-${name}`);
  pageEvidence.push({
    title: evidenceTitle(name),
    path
  });
}

export async function createEvidencePdf(context: RunContext, name: string, pageEvidence: PageEvidence[]): Promise<string> {
  if (pageEvidence.length === 0) {
    throw new Error(`Unable to create evidence PDF ${name} because no page screenshots were captured.`);
  }

  await mkdir(context.screenshotDir, { recursive: true });
  const pdfPath = join(context.screenshotDir, `${name}-${Date.now()}.pdf`);
  const html = await evidencePdfHtml(pageEvidence);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      margin: {
        top: "10mm",
        right: "8mm",
        bottom: "10mm",
        left: "8mm"
      }
    });
  } finally {
    await browser.close();
  }

  return pdfPath;
}

async function evidencePdfHtml(pageEvidence: PageEvidence[]): Promise<string> {
  const sections = await Promise.all(
    pageEvidence.map(async (item) => {
      const image = await readFile(item.path);
      const dataUrl = `data:image/png;base64,${image.toString("base64")}`;
      return `
        <section class="page-shot">
          <img src="${dataUrl}" alt="${escapeHtml(item.title)}" />
        </section>
      `;
    })
  );

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: #ffffff;
            color: #111827;
            font-family: Arial, Helvetica, sans-serif;
          }
          .page-shot {
            margin: 0 0 8px;
          }
          img {
            display: block;
            width: 100%;
            height: auto;
            border: 1px solid #d1d5db;
          }
        </style>
      </head>
      <body>${sections.join("\n")}</body>
    </html>
  `;
}

function evidenceTitle(name: string): string {
  return name
    .replace(/^\d+-/, "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
