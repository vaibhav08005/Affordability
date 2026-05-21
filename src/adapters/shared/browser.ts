import { chromium, type Locator, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AffordabilityResult } from "../../domain/contracts.js";
import type { RunContext } from "../types.js";

export interface BrowserSession {
  page: Page;
  close(): Promise<void>;
}

export async function createBrowserSession(context: RunContext, preferredUrl: string): Promise<BrowserSession> {
  if (context.executionMode === "attached") {
    if (!context.browserWSEndpoint) {
      throw new Error("Attached browser execution requires BROWSER_WS_ENDPOINT.");
    }

    const browser = await chromium.connectOverCDP(context.browserWSEndpoint);
    const browserContext = browser.contexts()[0] ?? await browser.newContext();
    const page =
      browserContext.pages().find((candidate) => candidate.url().startsWith(preferredUrl)) ??
      browserContext.pages()[0] ??
      await browserContext.newPage();
    await page.setViewportSize({ width: 1365, height: 1000 }).catch(() => undefined);

    return {
      page,
      async close() {
        await browser.close();
      }
    };
  }

  const browser = await chromium.launch({
    headless: context.headless,
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const browserContext = await browser.newContext({
    acceptDownloads: false,
    colorScheme: "light",
    extraHTTPHeaders: {
      "Accept-Language": "en-GB,en;q=0.9"
    },
    locale: "en-GB",
    timezoneId: "Europe/London",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: {
      width: 1365,
      height: 1000
    }
  });

  return {
    page: await browserContext.newPage(),
    async close() {
      await browser.close();
    }
  };
}

export async function captureEvidence(page: Page, context: RunContext, name: string): Promise<string> {
  await mkdir(context.screenshotDir, { recursive: true });
  const path = join(context.screenshotDir, `${name}-${Date.now()}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

export function categorizeError(error: unknown): NonNullable<AffordabilityResult["error"]>["category"] {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("navigation") || message.includes("goto")) return "navigation";
  if (message.includes("calculate")) return "calculate";
  if (message.includes("result")) return "result_extraction";
  if (message.includes("validation") || message.includes("required")) return "validation";
  if (message.includes("unavailable") || message.includes("problem") || message.includes("denied")) return "lender_unavailable";
  return "field_fill";
}

export async function clickFirstAvailableButton(page: Page, labels: string[]): Promise<boolean> {
  for (const label of labels) {
    const button = page.getByRole("button", { name: new RegExp(escapeRegExp(label), "i") });
    const buttonCount = await button.count();
    for (let index = 0; index < buttonCount; index += 1) {
      const candidate = button.nth(index);
      if (await isVisibleAndEnabled(candidate)) {
        await candidate.click({ force: true });
        return true;
      }
    }

    const text = page.getByText(new RegExp(`^${escapeRegExp(label)}$`, "i"));
    const textCount = await text.count();
    for (let index = 0; index < textCount; index += 1) {
      const candidate = text.nth(index);
      if (await isVisibleAndEnabled(candidate)) {
        await candidate.click({ force: true });
        return true;
      }
    }
  }

  return false;
}

export async function chooseFirstAvailableOption(scope: Page | Locator, options: string[], groupHints: string[] = []): Promise<boolean> {
  for (const groupHint of groupHints) {
    const groups = [
      scope.getByRole("group", { name: new RegExp(escapeRegExp(groupHint), "i") }),
      scope.getByRole("radiogroup", { name: new RegExp(escapeRegExp(groupHint), "i") })
    ];

    for (const group of groups) {
      if (await group.count() > 0 && await chooseWithinScope(group.first(), options)) return true;
    }
  }

  return chooseWithinScope(scope, options);
}

export async function selectFirstAvailableOption(
  scope: Page | Locator,
  labels: string[],
  optionLabels: string[]
): Promise<boolean> {
  for (const label of labels) {
    const field = scope.getByLabel(new RegExp(escapeRegExp(label), "i"));
    const count = await field.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = field.nth(index);
      if (await isSelect(candidate)) {
        if (await selectMatchingOption(candidate, optionLabels)) return true;
      }
    }
  }

  for (const label of labels) {
    const select = scope.locator(`xpath=.//*[contains(normalize-space(.), "${xpathLiteralText(label)}")]/following::select[1]`);
    if (await select.count() > 0 && await selectMatchingOption(select.first(), optionLabels)) return true;
  }

  return chooseFirstAvailableOption(scope, optionLabels, labels);
}

export async function fillFirstAvailableText(scope: Page | Locator, labels: string[], value: string): Promise<boolean> {
  for (const label of labels) {
    const labelled = scope.getByLabel(new RegExp(escapeRegExp(label), "i"));
    const count = await labelled.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = labelled.nth(index);
      if (await isFillable(candidate)) {
        await candidate.fill(value);
        return true;
      }
    }

    const byPlaceholder = scope.getByPlaceholder(new RegExp(escapeRegExp(label), "i"));
    const placeholderCount = await byPlaceholder.count();
    for (let index = 0; index < placeholderCount; index += 1) {
      const candidate = byPlaceholder.nth(index);
      if (await isFillable(candidate)) {
        await candidate.fill(value);
        return true;
      }
    }

    const afterLabel = scope.locator(`xpath=.//*[contains(normalize-space(.), "${xpathLiteralText(label)}")]/following::input[1]`);
    const afterLabelCount = await afterLabel.count();
    for (let index = 0; index < afterLabelCount; index += 1) {
      const candidate = afterLabel.nth(index);
      if (await isFillable(candidate)) {
        await candidate.fill(value);
        return true;
      }
    }
  }

  return false;
}

export async function fillFirstAvailableCurrency(scope: Page | Locator, labels: string[], value: number): Promise<boolean> {
  return fillFirstAvailableText(scope, labels, String(Math.round(value)));
}

export async function fillVisibleById(page: Page, id: string, value: string): Promise<boolean> {
  const field = page.locator(`#${cssIdentifier(id)}`);
  if (await field.count() === 0) return false;
  if (!(await isFillable(field.first()))) return false;
  await field.first().fill(value, { force: true });
  return true;
}

export async function selectVisibleById(page: Page, id: string, option: string): Promise<boolean> {
  const field = page.locator(`#${cssIdentifier(id)}`);
  if (await field.count() === 0) return false;
  if (!(await isVisibleAndEnabled(field.first()))) return false;
  await field.first().selectOption(option, { force: true }).catch(async () => {
    await selectMatchingOption(field.first(), [option]);
  });
  return true;
}

export function extractMaximumCurrency(text: string): number | null {
  const focusedPatterns = [
    /(?:maximum|could|can|able to|lend|borrow|lending amount|loan amount)[^£]{0,120}£\s*([0-9][0-9,]*)/i,
    /£\s*([0-9][0-9,]*)[^.\n]{0,120}(?:maximum|borrow|lend|afford|available)/i
  ];

  for (const pattern of focusedPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) return Number(match[1].replace(/,/g, ""));
  }

  const matches = [...text.matchAll(/£\s*([0-9][0-9,]*)/g)];
  if (matches.length === 0) return null;
  return Math.max(...matches.map((match) => Number(match[1]?.replace(/,/g, ""))));
}

export function resultMessages(text: string, limit = 30): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

async function chooseWithinScope(scope: Page | Locator, options: string[]): Promise<boolean> {
  for (const option of options) {
    const exact = new RegExp(`^${escapeRegExp(option)}$`, "i");
    const radio = scope.getByRole("radio", { name: exact });
    if (await radio.count() > 0) {
      await radio.first().click({ force: true });
      return true;
    }

    const button = scope.getByRole("button", { name: exact });
    if (await button.count() > 0) {
      await button.first().click({ force: true });
      return true;
    }

    const checkbox = scope.getByRole("checkbox", { name: exact });
    if (await checkbox.count() > 0) {
      await checkbox.first().check({ force: true });
      return true;
    }

    const text = scope.getByText(exact);
    const count = await text.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = text.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        await candidate.click({ force: true });
        return true;
      }
    }
  }

  return false;
}

async function selectMatchingOption(selectField: Locator, optionLabels: string[]): Promise<boolean> {
  const options = await selectField.locator("option").evaluateAll((nodes) =>
    nodes.map((node, index) => ({
      index,
      label: node.textContent?.trim() ?? "",
      value: (node as HTMLOptionElement).value
    }))
  );

  for (const optionLabel of optionLabels) {
    const option = options.find((candidate) => {
      const label = candidate.label.toLowerCase();
      const value = candidate.value.toLowerCase();
      const wanted = optionLabel.toLowerCase();
      return label === wanted || value === wanted || label.includes(wanted);
    });
    if (option) {
      await selectField.selectOption(option.value ? { value: option.value } : { index: option.index }, { force: true });
      return true;
    }
  }

  const firstRealOption = options.find((option) => option.index > 0 && option.value);
  if (firstRealOption) {
    await selectField.selectOption({ value: firstRealOption.value }, { force: true });
    return true;
  }

  return false;
}

async function isFillable(locator: Locator): Promise<boolean> {
  return locator.evaluate((node) => {
    const element = node as HTMLInputElement | HTMLTextAreaElement;
    const tagName = element.tagName.toLowerCase();
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    const textInputTypes = new Set(["", "text", "search", "email", "number", "tel", "url", "password"]);
    const visible = !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
    const editableInput = tagName === "input" && textInputTypes.has(type);
    return visible && !element.disabled && !element.readOnly && (editableInput || tagName === "textarea" || element.isContentEditable);
  }).catch(() => false);
}

async function isSelect(locator: Locator): Promise<boolean> {
  return locator.evaluate((node) => {
    const element = node as HTMLSelectElement;
    const visible = !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
    return node instanceof HTMLSelectElement && visible && !element.disabled;
  }).catch(() => false);
}

async function isVisibleAndEnabled(locator: Locator): Promise<boolean> {
  return (await locator.isVisible().catch(() => false)) && (await locator.isEnabled().catch(() => false));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function xpathLiteralText(value: string): string {
  return value.replace(/"/g, '\\"');
}

function cssIdentifier(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
