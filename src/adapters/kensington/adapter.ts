import type { Page } from "playwright";
import type { AffordabilityResult, Applicant, LenderReadyInput } from "../../domain/contracts.js";
import type { LenderAdapter, RunContext } from "../types.js";
import { captureEvidence, categorizeError, clickFirstAvailableButton, createBrowserSession, resultMessages } from "../shared/browser.js";
import {
  defaultProductRange,
  employmentStatusValues,
  KENSINGTON_CALCULATOR_URL,
  postcodeByRegion,
  sharedOwnershipProductRange
} from "./mapping.js";

export const kensingtonAdapter: LenderAdapter = {
  lender: "kensington",
  async run(input, context) {
    const startedAt = new Date().toISOString();
    const session = await createBrowserSession(context, KENSINGTON_CALCULATOR_URL);
    const page = session.page;
    page.setDefaultTimeout(context.timeoutMs);
    page.setDefaultNavigationTimeout(context.timeoutMs);

    try {
      await openKensingtonCalculator(page, context);
      const apiMaximumBorrowing = await fillKensingtonCalculator(page, input, context);
      await waitForResult(page, context, apiMaximumBorrowing != null);

      const result = await extractResult(page, apiMaximumBorrowing);
      if (result.maximumBorrowing == null) {
        const validation = validationMessages(result.messages.join("\n"));
        if (validation) {
          throw new Error(`Kensington validation blocked calculation: ${validation}`);
        }
        throw new Error(`Result extraction failed: Kensington did not return a maximum lending amount in RESIDENTIAL RESULTS. Seen text: ${result.messages.slice(0, 8).join(" | ")}`);
      }

      const screenshotPath = await captureEvidence(page, context, "kensington-success");
      return {
        lender: "kensington",
        status: "success",
        maximumBorrowing: result.maximumBorrowing,
        monthlyPayment: null,
        messages: result.messages,
        evidence: { screenshotPath, timestamp: startedAt }
      };
    } catch (error) {
      const screenshotPath = await captureEvidence(page, context, "kensington-failed").catch(() => undefined);
      return {
        lender: "kensington",
        status: "failed",
        maximumBorrowing: null,
        monthlyPayment: null,
        messages: [],
        evidence: { screenshotPath, timestamp: startedAt },
        error: {
          category: categorizeError(error),
          message: error instanceof Error ? error.message : String(error)
        }
      };
    } finally {
      await session.close();
    }
  }
};

async function openKensingtonCalculator(page: Page, context: RunContext): Promise<void> {
  await page.goto(KENSINGTON_CALCULATOR_URL, { waitUntil: "networkidle" });
  await clickFirstAvailableButton(page, ["Reject optional cookies", "Accept optional cookies"]).catch(() => undefined);
  await page.locator("#clientName").waitFor({ state: "visible", timeout: Math.min(context.timeoutMs, 20000) });
}

async function fillKensingtonCalculator(page: Page, input: LenderReadyInput, context: RunContext): Promise<number | null> {
  await setInputValueById(page, "clientName", "Kensington Test Client");
  await setInputValueById(page, "loan_term_requested", String(input.case.termYears));
  await clickButtonAfterQuestion(page, "What type of mortgage will it be?", input.case.mortgagePurpose === "purchase" ? "Purchase" : "Remortgage");

  const productRange = input.case.sharedOwnershipOrEquity ? sharedOwnershipProductRange : defaultProductRange;
  await setSelectValueById(page, "product", productRange);
  await page.waitForTimeout(1000);
  await selectProduct(page, input);

  await setInputValueById(page, "property_valuation", money(input.loan.propertyValue));
  await setInputValueById(page, "loan_amount", money(input.loan.loanAmount));
  if (input.case.mortgagePurpose !== "purchase") {
    await clickButtonAfterQuestion(page, "Was the original purchase made with the assistance", input.case.sharedOwnershipOrEquity ? "Yes" : "No");
  }
  await clickButtonAfterQuestion(page, "Is the application defined as credit impaired?", "No");
  await clickButtonAfterQuestion(page, "Do you know the property details?", "Yes");
  await setInputValueById(page, "postcode", postcode(input));

  await clickButtonAfterQuestion(page, "Is this a single or joint application?", input.case.numberOfApplicants === 1 ? "Single Applicant" : "Joint Applicant");
  await page.waitForTimeout(500);
  for (const applicant of input.applicants) {
    await fillApplicant(page, applicant, input);
  }

  await clickChoiceAfterQuestion(page, "Number of dependants", dependantButton(input));
  await fillDependantAges(page, input);
  await setInputValueById(page, "shared_ownership_rent", money(input.case.monthlySharedOwnershipRent ?? 0));
  await setInputValueById(page, "ground_rent_service_charge", money(groundRentAndService(input)));
  await setInputValueById(page, "childcare", money(childcare(input)));
  await setInputValueById(page, "maintenance", money(maintenance(input)));
  await setInputValueById(page, "school_fees", money(schoolFees(input)));
  await setInputValueById(page, "credit_expenditure1", money(monthlyCreditCommitments(input)));
  await setInputValueById(page, "revolvingCreditBalance", money(input.outgoings.creditCardBalances + input.outgoings.overdraftBalances));

  const apiResult = page.waitForResponse((response) => response.url().includes("/kmc-api/webcalculator"), { timeout: Math.min(context.timeoutMs, 20000) }).catch(() => null);
  await page.locator("#SubmitButton").click({ force: true });
  const response = await Promise.race([
    apiResult,
    page.waitForFunction(
      () => /RESIDENTIAL RESULTS|There are invalid entries|must be a whole number|please check your input values/i.test(document.body.innerText),
      undefined,
      { timeout: Math.min(context.timeoutMs, 20000) }
    ).then(() => null).catch(() => null)
  ]);
  if (!response) return null;
  return parseApiMaximum(await response.text().catch(() => ""));
}

async function fillApplicant(page: Page, applicant: Applicant, input: LenderReadyInput): Promise<void> {
  const index = applicant.index - 1;
  await setInputValueById(page, "post_code", postcode(input), index);
  await setInputValueById(page, "date_of_birth", applicant.dateOfBirth ? toUkDate(applicant.dateOfBirth) : dateFromAge(applicant.age), index);
  await setSelectValueById(page, "planned_retirement_age", String(Math.min(Math.max(applicant.retirementAge ?? 70, 50), 90)), index);

  const status = applicant.employment.isContractor ? "Contractor" : employmentStatusValues[applicant.employment.type];
  await setSelectByBind(page, "employment_status", status, index);
  await page.waitForTimeout(300);

  if (status === "Employed") {
    await setApplicantInputByBind(page, index, "salary.formatted", money(applicant.employment.annualGrossIncome ?? 0));
    await setApplicantInputByBind(page, index, "bonus.formatted", money(applicant.employment.annualBonus ?? 0));
    await setApplicantInputByBind(page, index, "commission.formatted", money(applicant.employment.annualCommission ?? 0));
    await setApplicantInputByBind(page, index, "overtime.formatted", money(applicant.employment.annualOvertime ?? 0));
    await setApplicantInputByBind(page, index, "allowances.formatted", money(allowanceIncome(applicant)));
  } else if (status === "Self-Employed") {
    await setApplicantInputByBind(page, index, "self_employed_income.formatted", money(primarySelfEmployedIncome(applicant)));
  } else if (status === "Contractor") {
    await setApplicantInputByBind(page, index, "salary.formatted", money(primarySelfEmployedIncome(applicant)));
  }

  const extraIncome = extraAnnualIncome(applicant);
  if (extraIncome > 0 || status === "Retired" || status === "Not Employed") {
    await addOtherIncome(page, index, otherIncomeCategory(applicant), money(extraIncome || primaryPensionIncome(applicant)));
  }
}

async function addOtherIncome(page: Page, applicantIndex: number, category: string, amount: string): Promise<void> {
  const beforeRows = await page.locator("select#Select4").count();
  await page.locator("button[data-bind*='addincomedd']").nth(applicantIndex).click({ force: true });
  await page.waitForFunction((count) => document.querySelectorAll("select#Select4").length > count, beforeRows, { timeout: 5000 }).catch(() => undefined);
  const rowIndex = Math.max(beforeRows, 0);
  await page.locator("select#Select4").nth(rowIndex).selectOption(category, { force: true }).catch(async () => {
    await page.locator("select#Select4").nth(rowIndex).selectOption({ index: 0 }, { force: true });
  });
  await setInputValueByBind(page, "income_amount.formatted", amount, rowIndex);
  await setInputValueById(page, "income_start_date", "01/01/2020", rowIndex);
}

async function fillDependantAges(page: Page, input: LenderReadyInput): Promise<void> {
  const count = Math.min(input.household.dependants.length, 4);
  for (let index = 0; index < count; index += 1) {
    const age = Math.max(1, Math.round(input.household.dependants[index]?.age ?? 1));
    await setInputValueByBind(page, "textInput: age", String(age), index);
  }
}

async function selectProduct(page: Page, input: LenderReadyInput): Promise<void> {
  const product = await page.locator("#product1").evaluate((select, args) => {
    const element = select as HTMLSelectElement;
    const labels = [...element.options].map((option, index) => ({ index, label: option.textContent?.trim() ?? "" }));
    const initialPeriod = String(args.initialPeriod);
    const ltvBucket = Number(args.ltvBucket);
    const candidates = labels
      .filter((option) => new RegExp(`${initialPeriod}yr`, "i").test(option.label))
      .filter((option) => new RegExp(`\\b${ltvBucket}\\b`).test(option.label))
      .map((option) => ({ ...option, rate: Number(option.label.match(/([0-9]+(?:\\.[0-9]+)?)%\\s*$/)?.[1] ?? "999") }))
      .sort((a, b) => a.rate - b.rate || a.index - b.index);
    return candidates[0] ?? labels.find((option) => /Default 5yr/i.test(option.label)) ?? labels.find((option) => option.index > 0);
  }, { initialPeriod: initialPeriod(input), ltvBucket: ltvBucket(input) });

  if (!product) throw new Error("Kensington product selection failed: no product options available.");
  await page.locator("#product1").selectOption({ index: product.index }, { force: true });
  await page.locator("#product1").dispatchEvent("change");
  await page.waitForTimeout(500);
}

async function waitForResult(page: Page, context: RunContext, hasApiResult: boolean): Promise<void> {
  const timeout = hasApiResult ? 8000 : Math.min(context.timeoutMs, 12000);
  await page.waitForFunction(
    () =>
      (/RESIDENTIAL RESULTS/i.test(document.body.innerText) &&
        /maximum we may lend/i.test(document.body.innerText) &&
        /[0-9][0-9,]{2,}/.test(document.body.innerText.slice(document.body.innerText.search(/maximum we may lend/i)))) ||
      /There are invalid entries|must be a whole number|please check your input values/i.test(document.body.innerText),
    undefined,
    { timeout }
  ).catch(() => undefined);
}

async function extractResult(page: Page, apiMaximumBorrowing: number | null): Promise<{ maximumBorrowing: number | null; monthlyPayment: null; messages: string[] }> {
  const text = await page.locator("body").innerText();
  const fallbackText = await page.locator("body").textContent().catch(() => "");
  const extractionText = /RESIDENTIAL RESULTS/i.test(text) ? text : fallbackText ?? text;
  const resultIndex = extractionText.toUpperCase().lastIndexOf("RESIDENTIAL RESULTS");
  const hasVisibleResults = await page.getByText(/RESIDENTIAL RESULTS/i).last().isVisible().catch(() => false);
  if (resultIndex < 0 || /Please enter|required|must select|Please select/i.test(extractionText.slice(resultIndex))) {
    if (apiMaximumBorrowing != null && hasVisibleResults) {
      return {
        maximumBorrowing: apiMaximumBorrowing,
        monthlyPayment: null,
        messages: ["RESIDENTIAL RESULTS", `The maximum we may lend you is (including fees) £${Math.round(apiMaximumBorrowing).toLocaleString("en-GB")}`]
      };
    }
    return { maximumBorrowing: null, monthlyPayment: null, messages: resultMessages(text) };
  }
  const resultText = extractionText.slice(resultIndex);
  const amount = extractMaximumFromText(resultText) ?? apiMaximumBorrowing;
  return {
    maximumBorrowing: amount,
    monthlyPayment: null,
    messages: resultMessages(resultText)
  };
}

function parseApiMaximum(rawText: string): number | null {
  try {
    const outer = JSON.parse(rawText) as string | { calculator_output?: { maximum_balance?: number } };
    const payload = typeof outer === "string" ? JSON.parse(outer) : outer;
    const maximum = payload?.calculator_output?.maximum_balance;
    return typeof maximum === "number" && Number.isFinite(maximum) ? maximum : null;
  } catch {
    return null;
  }
}

function extractMaximumFromText(text: string | null): number | null {
  if (!text) return null;
  const resultIndex = text.toUpperCase().lastIndexOf("RESIDENTIAL RESULTS");
  const resultText = resultIndex >= 0 ? text.slice(resultIndex) : text;
  const phraseIndex = resultText.search(/maximum we may lend/i);
  const amountScope = phraseIndex >= 0 ? resultText.slice(phraseIndex, phraseIndex + 300) : resultText;
  const match = amountScope.match(/([0-9][0-9,]{2,})/);
  return match?.[1] ? Number(match[1].replace(/,/g, "")) : null;
}

function validationMessages(messages: string): string {
  return messages
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /invalid entries|must be a whole number|required|please check|please enter|please select/i.test(line))
    .slice(0, 8)
    .join(" | ");
}

async function clickButtonAfterQuestion(page: Page, question: string, label: string): Promise<void> {
  const clicked = await page.evaluate(({ question, label }) => {
    const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
    const marker = [...document.querySelectorAll("label,h1,h2,h3,h4,p,div,button")]
      .filter((node) => clean(node.textContent).includes(question))
      .sort((a, b) => clean(a.textContent).length - clean(b.textContent).length)[0];
    const markerTop = marker?.getBoundingClientRect().top ?? -Infinity;
    const buttons = [...document.querySelectorAll("button")]
      .filter((button) => clean(button.textContent) === label)
      .filter((button) => !!(button.offsetWidth || button.offsetHeight || button.getClientRects().length))
      .filter((button) => button.getBoundingClientRect().top >= markerTop)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    buttons[0]?.click();
    return Boolean(buttons[0]);
  }, { question, label });
  if (!clicked) throw new Error(`Kensington field fill failed: could not click ${label} for ${question}.`);
  await page.waitForTimeout(250);
}

async function clickChoiceAfterQuestion(page: Page, question: string, label: string): Promise<void> {
  const clicked = await page.evaluate(({ question, label }) => {
    const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
    const marker = [...document.querySelectorAll("label,h1,h2,h3,h4,p,div,button")]
      .filter((node) => clean(node.textContent).includes(question))
      .sort((a, b) => clean(a.textContent).length - clean(b.textContent).length)[0];
    const markerTop = marker?.getBoundingClientRect().top ?? -Infinity;
    const choices = [...document.querySelectorAll("button,label,span,a,div")]
      .filter((node) => clean(node.textContent) === label)
      .filter((node) => !!(node as HTMLElement).offsetWidth || !!(node as HTMLElement).offsetHeight || node.getClientRects().length > 0)
      .filter((node) => node.getBoundingClientRect().top >= markerTop)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    (choices[0] as HTMLElement | undefined)?.click();
    return Boolean(choices[0]);
  }, { question, label });
  if (!clicked) throw new Error(`Kensington field fill failed: could not click ${label} for ${question}.`);
  await page.waitForTimeout(250);
}

async function setInputValueById(page: Page, id: string, value: string, index = 0): Promise<void> {
  const field = page.locator(`#${cssAttributeValue(id)}`).nth(index);
  if (await field.count() === 0 || !(await field.isVisible().catch(() => false))) return;
  await field.fill(value, { force: true });
  await field.evaluate((node, nextValue) => {
    const input = node as HTMLInputElement;
    input.value = nextValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
  }, value);
}

async function setInputValueByBind(page: Page, bindFragment: string, value: string, index = 0): Promise<void> {
  const field = page.locator(`input[data-bind*="${cssAttributeValue(bindFragment)}"]`).nth(index);
  if (await field.count() === 0 || !(await field.isVisible().catch(() => false))) return;
  await field.fill(value, { force: true });
  await field.evaluate((node, nextValue) => {
    const input = node as HTMLInputElement;
    input.value = nextValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
  }, value);
}

async function setApplicantInputByBind(page: Page, applicantIndex: number, bindFragment: string, value: string): Promise<void> {
  const filled = await page.evaluate(({ applicantIndex, bindFragment, value }) => {
    const employmentSelect = [...document.querySelectorAll<HTMLSelectElement>("select[data-bind*='employment_status']")]
      .filter((select) => !!(select.offsetWidth || select.offsetHeight || select.getClientRects().length))[applicantIndex];
    if (!employmentSelect) return false;
    const anchor = employmentSelect.getBoundingClientRect();
    const fields = [...document.querySelectorAll<HTMLInputElement>(`input[data-bind*="${bindFragment}"]`)]
      .filter((input) => !!(input.offsetWidth || input.offsetHeight || input.getClientRects().length))
      .filter((input) => {
        const rect = input.getBoundingClientRect();
        return Math.abs(rect.left - anchor.left) < 180 && rect.top >= anchor.top && rect.top <= anchor.top + 260;
      })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const field = fields[0];
    if (!field) return false;
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }, { applicantIndex, bindFragment, value });

  if (!filled) {
    await setInputValueByBind(page, bindFragment, value, 0);
  }
}

async function setSelectValueById(page: Page, id: string, value: string, index = 0): Promise<void> {
  const field = page.locator(`#${cssAttributeValue(id)}`).nth(index);
  if (await field.count() === 0 || !(await field.isVisible().catch(() => false))) return;
  await field.selectOption(value, { force: true });
  await field.dispatchEvent("change");
}

async function setSelectByBind(page: Page, bindFragment: string, value: string, index = 0): Promise<void> {
  const field = page.locator(`select[data-bind*="${cssAttributeValue(bindFragment)}"]`).nth(index);
  await field.selectOption(value, { force: true });
  await field.dispatchEvent("change");
}

function postcode(input: LenderReadyInput): string {
  return input.property.isInScotland ? postcodeByRegion.scotland : postcodeByRegion.england;
}

function initialPeriod(input: LenderReadyInput): 2 | 5 {
  return /2\s*(?:yr|year)|two/i.test(input.case.journey) ? 2 : 5;
}

function ltvBucket(input: LenderReadyInput): number {
  const ltv = (input.loan.loanAmount / Math.max(input.loan.propertyValue, 1)) * 100;
  return [75, 80, 85, 90, 95].find((bucket) => ltv <= bucket) ?? 95;
}

function dependantButton(input: LenderReadyInput): string {
  const count = input.household.dependants.length;
  return count >= 4 ? "4+" : String(count);
}

function groundRentAndService(input: LenderReadyInput): number {
  return input.property.tenure === "leasehold" ? 100 : 0;
}

function childcare(input: LenderReadyInput): number {
  return input.household.dependants.filter((dependant) => dependant.age < 12).length * 150;
}

function maintenance(input: LenderReadyInput): number {
  return Math.round(input.outgoings.otherMonthlyOutgoings * 0.25);
}

function schoolFees(input: LenderReadyInput): number {
  return Math.round(input.outgoings.otherMonthlyOutgoings * 0.25);
}

function monthlyCreditCommitments(input: LenderReadyInput): number {
  const otherPropertyPayments = input.otherProperties.reduce((sum, property) => sum + property.monthlyMortgagePayment, 0);
  return input.outgoings.monthlyLoanRepayments + input.outgoings.monthlyBuyToLetPayments + otherPropertyPayments;
}

function primarySelfEmployedIncome(applicant: Applicant): number {
  return applicant.employment.netProfitCurrentYear ?? applicant.employment.annualGrossIncome ?? 0;
}

function primaryPensionIncome(applicant: Applicant): number {
  return (applicant.employment.annualPensionIncome ?? 0) + (applicant.employment.otherAnnualPensionIncome ?? 0);
}

function allowanceIncome(applicant: Applicant): number {
  return applicant.otherIncome
    .filter((income) => ["town_area_or_car_allowance", "shift_allowance"].includes(income.type))
    .reduce((sum, income) => sum + income.annualAmount, 0);
}

function extraAnnualIncome(applicant: Applicant): number {
  const pension = applicant.employment.type === "pension" ? primaryPensionIncome(applicant) : applicant.employment.otherAnnualPensionIncome ?? 0;
  return pension + applicant.otherIncome.filter((income) => !["town_area_or_car_allowance", "shift_allowance"].includes(income.type)).reduce((sum, income) => sum + income.annualAmount, 0);
}

function otherIncomeCategory(applicant: Applicant): string {
  if (applicant.employment.type === "pension") return "Private/employer Pension";
  const type = applicant.otherIncome[0]?.type;
  if (type === "child_benefit") return "Child Benefit";
  if (type === "maintenance") return "Maintenance Payments";
  if (type === "rental_income_btl") return "Taxable Rental Income";
  if (type === "investment_income") return "Investment";
  if (type === "trust_income") return "Trust Income";
  return "Second Employed Income";
}

function toUkDate(value: string): string {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return value;
}

function dateFromAge(age: number): string {
  const year = new Date().getFullYear() - age;
  return `01/01/${year}`;
}

function money(value: number): string {
  return String(Math.round(value));
}

function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
