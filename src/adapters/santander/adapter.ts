import type { Page } from "playwright";
import type { AffordabilityResult, Applicant, LenderReadyInput, RepaymentType } from "../../domain/contracts.js";
import type { LenderAdapter, RunContext } from "../types.js";
import {
  captureEvidence,
  categorizeError,
  chooseFirstAvailableOption,
  clickFirstAvailableButton,
  createBrowserSession,
  extractMaximumCurrency,
  fillFirstAvailableCurrency,
  fillFirstAvailableText,
  fillVisibleById,
  resultMessages,
  selectFirstAvailableOption,
  selectVisibleById
} from "../shared/browser.js";
import {
  mortgageTypeLabels,
  remortgageReasonLabels,
  repaymentMethodLabels,
  otherPropertyUseLabels,
  otherPropertyRepaymentLabels,
  SANTANDER_CALCULATOR_URL
} from "./mapping.js";

export const santanderAdapter: LenderAdapter = {
  lender: "santander",
  async run(input, context) {
    const startedAt = new Date().toISOString();
    const session = await createBrowserSession(context, SANTANDER_CALCULATOR_URL);
    const page = session.page;
    page.setDefaultTimeout(context.timeoutMs);
    page.setDefaultNavigationTimeout(context.timeoutMs);

    try {
      await openSantanderCalculator(page, context);
      await fillSantanderCalculator(page, input);
      await waitForResult(page, context);

      const result = await extractResult(page);
      if (result.maximumBorrowing == null) {
        throw new Error("Result extraction failed: Santander did not return a maximum borrowing amount.");
      }

      const screenshotPath = await captureEvidence(page, context, "santander-success");
      return {
        lender: "santander",
        status: "success",
        maximumBorrowing: result.maximumBorrowing,
        monthlyPayment: result.monthlyPayment,
        messages: result.messages,
        evidence: {
          screenshotPath,
          timestamp: startedAt
        }
      };
    } catch (error) {
      const screenshotPath = await captureEvidence(page, context, "santander-failed").catch(() => undefined);
      return {
        lender: "santander",
        status: "failed",
        maximumBorrowing: null,
        monthlyPayment: null,
        messages: [],
        evidence: {
          screenshotPath,
          timestamp: startedAt
        },
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

async function openSantanderCalculator(page: Page, context: RunContext): Promise<void> {
  await page.goto(SANTANDER_CALCULATOR_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  await clickFirstAvailableButton(page, ["Accept all cookies", "Reject all", "No, continue"]).catch(() => undefined);
  await page.locator("#AffordabilityCalculator").waitFor({ state: "visible", timeout: Math.min(context.timeoutMs, 20000) });
  await clickFirstAvailableButton(page, ["Accept all cookies", "Reject all", "No, continue"]).catch(() => undefined);
}

async function fillSantanderCalculator(page: Page, input: LenderReadyInput): Promise<void> {
  await fillMortgageDetails(page, input);
  await advance(page);
  await page.getByText(/^Other properties$/i).first().waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
  await fillOtherProperties(page, input);
  await advance(page);
  if (!(await isSantanderSection(page, "Annual gross income"))) {
    if (await isSantanderSection(page, "Commitments and expenditure")) {
      await setSantanderIncomeStore(page, input);
      await fillOutgoings(page, input);
      if (!(await clickLastCalculatorButton(page, ["Calculate", "Get results", "Continue"]))) {
        await clickFirstAvailableButton(page, ["Calculate", "Get results", "Continue"]);
      }
      return;
    }
    throw new Error(`Santander did not advance from Other properties to Income. ${await santanderFailureContext(page)}`);
  }
  await fillIncome(page, input);
  await advance(page);
  if (!(await isSantanderSection(page, "Commitments and expenditure"))) {
    throw new Error(`Santander did not advance from Income to Commitments and expenditure. ${await santanderFailureContext(page)}`);
  }
  await fillOutgoings(page, input);
  if (!(await clickLastCalculatorButton(page, ["Calculate", "Get results", "Continue"]))) {
    await clickFirstAvailableButton(page, ["Calculate", "Get results", "Continue"]);
  }
}

async function fillMortgageDetails(page: Page, input: LenderReadyInput): Promise<void> {
  await chooseFirstAvailableOption(page, [input.case.numberOfApplicants === 1 ? "Single" : "Joint"], ["application"]);
  await selectFirstAvailableOption(page, ["Number of financial dependants", "Dependants"], [
    dependantOption(input.household.dependants.length)
  ]);
  await chooseFirstAvailableOption(page, mortgageTypeLabels[input.case.mortgagePurpose], ["Mortgage type"]);
  if (input.case.mortgagePurpose !== "purchase") {
    await page.locator("#RemortgageReason").waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
    await selectVisibleById(page, "RemortgageReason", remortgageReasonLabels[input.case.mortgagePurpose][0]) ||
      await selectFirstAvailableOption(page, ["Reason for remortgaging"], remortgageReasonLabels[input.case.mortgagePurpose]) ||
      await chooseFirstAvailableOption(page, remortgageReasonLabels[input.case.mortgagePurpose], ["Remortgage"]);
  }
  await fillVisibleById(page, "PropertyValue", String(Math.round(input.loan.propertyValue))) ||
    await fillFirstAvailableCurrency(page, ["Estimated property value", "Property value"], input.loan.propertyValue);
  if (input.case.mortgagePurpose !== "purchase") {
    await fillSantanderCurrentBalance(page, input);
    await chooseBorrowersSameAsCurrentMortgage(page);
    await fillSantanderCurrentBalance(page, input);
  }
  await selectFirstAvailableOption(page, ["Repayment method"], santanderRepaymentMethodLabels(input));
  if (input.case.repaymentType !== "capital_and_interest") {
    await chooseCombinedGrossIncomeOver200k(page, totalApplicantsGrossIncome(input) >= 200000 ? "Yes" : "No");
  }
  if (input.case.repaymentType !== "capital_and_interest") {
    await fillVisibleById(page, "InterestOnlyAmt", String(Math.round(input.case.interestOnlyLoanAmount ?? input.loan.loanAmount))) ||
      await fillFirstAvailableCurrency(page, ["Amount required on interest only"], input.case.interestOnlyLoanAmount ?? input.loan.loanAmount);
  }
  await fillVisibleById(
    page,
    "CapitalAndInterestAmt",
    String(Math.round(input.case.repaymentType === "interest_only" ? 0 : input.loan.loanAmount - (input.case.interestOnlyLoanAmount ?? 0)))
  ) || await fillFirstAvailableCurrency(
      page,
      ["Amount required on capital and interest"],
      input.case.repaymentType === "interest_only" ? 0 : input.loan.loanAmount - (input.case.interestOnlyLoanAmount ?? 0)
    );
  await fillFirstAvailableText(page, ["How old will the oldest applicant be on their next birthday"], String(oldestApplicantNextBirthdayAge(input)));
  await selectVisibleById(page, "TermYears", String(input.case.termYears));
  await selectVisibleById(page, "TermMonths", "0");
  await setSantanderDetailsStore(page, input);
  await fillVisibleById(page, "PropertyValue", String(Math.round(input.loan.propertyValue)));
  if (input.case.mortgagePurpose !== "purchase") {
    await fillSantanderCurrentBalance(page, input);
    await chooseBorrowersSameAsCurrentMortgage(page);
    await fillSantanderCurrentBalance(page, input);
  }
  await fillFirstAvailableText(page, ["How old will the oldest applicant be on their next birthday"], String(oldestApplicantNextBirthdayAge(input)));
  await selectVisibleById(page, "TermYears", String(input.case.termYears));
  await selectVisibleById(page, "TermMonths", "0");
  await setSantanderDetailsStore(page, input);
  if (input.case.mortgagePurpose !== "purchase") {
    await chooseBorrowersSameAsCurrentMortgage(page);
    await fillSantanderCurrentBalance(page, input);
  }
}

async function fillSantanderCurrentBalance(page: Page, input: LenderReadyInput): Promise<void> {
  const currentBalance = santanderCurrentBalance(input);
  await fillInputAfterText(page, "What's their current total balance?", currentBalance);
  await fillVisibleById(page, "CurrentBalance", String(currentBalance)) ||
    await fillVisibleById(page, "ExistingMortgageBalance", String(currentBalance)) ||
    await fillFirstAvailableCurrency(page, ["What's their current total balance", "Current balance", "customer's current balance"], currentBalance);
}

async function fillOtherProperties(page: Page, input: LenderReadyInput): Promise<void> {
  const propertyCards = santanderOtherPropertyCards(input);
  const hasOtherProperties = propertyCards.length > 0;
  await chooseOptionAfterQuestion(
    page,
    "Will your client own any other properties on completion of this mortgage?",
    hasOtherProperties ? "Yes" : "No"
  );
  await chooseOptionAfterQuestion(
    page,
    "Are the applicants looking to borrow more than 90% LTV?",
    loanToValue(input) > 0.9 ? "Yes" : "No"
  );
  await page.waitForTimeout(300);
  if (!hasOtherProperties) return;
  await chooseOptionAfterQuestion(
    page,
    "Do you want to provide these details now?",
    "Yes"
  );
  await page.waitForTimeout(300);

  await selectFirstAvailableOption(page, ["How many mortgaged properties", "mortgaged properties"], [
    String(Math.min(propertyCards.length, 5))
  ]);
  await selectFirstAvailableOption(page, ["How many mortgage free properties", "mortgage free"], ["0"]);
  await page.waitForTimeout(500);

  for (const card of propertyCards.slice(0, 5)) {
    const cardHeading = `Mortgaged property ${card.index + 1}`;
    await selectAfterHeading(page, cardHeading, "Property use", [
      card.isRental ? otherPropertyUseLabels.alreadyLet : otherPropertyUseLabels.holidayHomeOrSecondHome
    ]);
    await page.waitForTimeout(300);
    await fillCurrencyAfterHeading(page, cardHeading, "Estimated property value", card.propertyValue);
    await fillCurrencyAfterHeading(page, cardHeading, "Mortgage balance", card.mortgageBalance);
    await selectAfterHeading(page, cardHeading, "Type of mortgage", otherPropertyRepaymentLabels[card.repaymentType]);
    if (card.repaymentType === "part_and_part") {
      await fillCurrencyAfterHeading(page, cardHeading, "Repayment balance", Math.max(0, card.mortgageBalance - card.interestOnlyBalance));
      await fillCurrencyAfterHeading(page, cardHeading, "Interest only balance", card.interestOnlyBalance);
    }
    await selectAfterHeading(page, cardHeading, "Remaining term", [String(card.remainingTermYears)], 0);
    await selectAfterHeading(page, cardHeading, "Remaining term", ["0"], 1);
    await fillCurrencyAfterHeading(page, cardHeading, "Monthly mortgage payment", card.monthlyMortgagePayment);
    await fillCurrencyAfterHeading(page, cardHeading, "Monthly gross rent", card.monthlyRent);
    await chooseOptionAfterHeadingQuestion(page, cardHeading, "Will the rent be received in a foreign currency?", "No");
    await chooseOptionAfterHeadingQuestion(
      page,
      cardHeading,
      "Are all owners willing to switch the whole loan to interest only if they experience financial difficulties?",
      "No"
    );
    await chooseFirstAvailableOption(page, [card.isRental ? "Yes" : "No"], ["rented at full market value", "let the property"]);
  }
}

async function fillIncome(page: Page, input: LenderReadyInput): Promise<void> {
  for (const applicant of input.applicants) {
    await fillApplicantIncome(page, applicant);
  }
  await setSantanderIncomeStore(page, input);
}

async function fillApplicantIncome(page: Page, applicant: Applicant): Promise<void> {
  const prefix = applicant.index === 1 ? "Applicant 1" : "Applicant 2";
  const basicIncome = applicant.employment.type === "self_employed" ? 0 : applicant.employment.annualGrossIncome ?? 0;
  await fillVisibleById(page, `Applicant${applicant.index}Basic`, String(Math.round(basicIncome)));
  await fillFirstAvailableCurrency(page, [`${prefix} gross basic income`, "Gross basic income", "Gross annual income"], basicIncome);
  await fillSelfEmploymentIncome(page, applicant);
  await fillFirstAvailableCurrency(page, [`${prefix} pension income`, "Pension income"], applicant.employment.annualPensionIncome ?? 0);
  await fillFirstAvailableCurrency(page, [`${prefix} other income`, "Other income"], totalOtherIncome(applicant));
}

async function fillSelfEmploymentIncome(page: Page, applicant: Applicant): Promise<void> {
  if (applicant.employment.type !== "self_employed") return;

  const applicantId = `Applicant${applicant.index}`;
  const latestProfit = Math.round(applicant.employment.netProfitCurrentYear ?? 0);
  const previousProfit = Math.round(applicant.employment.netProfitPreviousYear ?? latestProfit);

  if (applicant.employment.businessType === "limited_company") {
    await chooseFirstAvailableOption(page, ["Yes"], ["salary for a director of a limited company", "limited company"]);
    await page.waitForTimeout(250);
    await fillVisibleById(page, `${applicantId}DirectorSalaryLatest`, String(Math.round(applicant.employment.annualGrossIncome ?? 0)));
    await fillVisibleById(page, `${applicantId}DirectorSalaryPrevious`, String(Math.round(applicant.employment.annualGrossIncome ?? 0)));
    await fillVisibleById(page, `${applicantId}DividendsLatest`, String(latestProfit));
    await fillVisibleById(page, `${applicantId}DividendsPrevious`, String(previousProfit));
    return;
  }

  await chooseFirstAvailableOption(page, ["Yes"], ["net profit from a sole trader", "sole trader/partnership"]);
  await page.waitForTimeout(250);
  await fillVisibleById(page, `${applicantId}SoleTraderLatest`, String(latestProfit));
  await fillVisibleById(page, `${applicantId}SoleTraderPrevious`, String(previousProfit));
}

async function fillOutgoings(page: Page, input: LenderReadyInput): Promise<void> {
  await fillFirstAvailableCurrency(
    page,
    [
      "Please enter the total monthly payments for all credit commitments excluding credit cards and mortgages on other properties",
      "Total monthly payments of any outstanding loans",
      "Total monthly loan payments"
    ],
    input.outgoings.monthlyLoanRepayments
  );
  await fillFirstAvailableCurrency(
    page,
    [
      "Credit cards only: please enter the total outstanding balance for all credit cards",
      "Total outstanding credit card balances",
      "Outstanding credit card balances"
    ],
    input.outgoings.creditCardBalances + input.outgoings.overdraftBalances
  );
  const otherMonthlyCommitted = input.outgoings.otherMonthlyOutgoings + input.outgoings.monthlyBuyToLetPayments;
  await chooseFirstAvailableOption(page, [otherMonthlyCommitted > 0 ? "Yes" : "No"], [
    "Do you want to enter any other monthly committed expenditure",
    "other monthly committed expenditure"
  ]);
  if (otherMonthlyCommitted > 0) {
    await fillFirstAvailableCurrency(
      page,
      [
        "Any other expenditure you think we'll need to consider",
        "Any other expenditure",
        "Other monthly committed expenditure",
        "Monthly committed expenditure"
      ],
      otherMonthlyCommitted
    );
  }
}

async function advance(page: Page): Promise<void> {
  if (!(await clickLastCalculatorButton(page, ["Continue", "Next"])) && !(await clickLastAvailableButton(page, ["Continue", "Next"]))) {
    await clickFirstAvailableButton(page, ["Continue", "Next"]);
  }
  await page.waitForTimeout(1500);
}

async function clickLastCalculatorButton(page: Page, labels: string[]): Promise<boolean> {
  for (const label of labels) {
    const candidates = page.locator("#AffordabilityCalculator button").filter({ hasText: new RegExp(`^\\s*${label}\\s*$`, "i") });
    for (let index = (await candidates.count()) - 1; index >= 0; index -= 1) {
      const candidate = candidates.nth(index);
      if (await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false)) {
        await candidate.scrollIntoViewIfNeeded().catch(() => undefined);
        await candidate.click({ force: true });
        return true;
      }
    }
  }

  return false;
}

async function clickLastAvailableButton(page: Page, labels: string[]): Promise<boolean> {
  for (const label of labels) {
    const candidates = page.getByRole("button", { name: new RegExp(`^${label}$`, "i") });
    for (let index = (await candidates.count()) - 1; index >= 0; index -= 1) {
      const candidate = candidates.nth(index);
      if (await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false)) {
        await candidate.scrollIntoViewIfNeeded().catch(() => undefined);
        await candidate.click({ force: true });
        return true;
      }
    }
  }

  return false;
}

async function waitForResult(page: Page, context: RunContext): Promise<void> {
  await page.waitForFunction(
    () => {
      const app = document.querySelector("#AffordabilityCalculator") as (Element & { __vue_app__?: { config?: { globalProperties?: { $route?: { name?: string } } } } }) | null;
      const routeName = app?.__vue_app__?.config?.globalProperties?.$route?.name;
      const text = document.body.innerText;
      return !/loading/i.test(text) && (routeName === "Results" || /the following errors|error|required|please enter|please select/i.test(text));
    },
    undefined,
    { timeout: Math.min(context.timeoutMs, 60000) }
  ).catch(() => undefined);
}

async function waitForSantanderSection(page: Page, title: string): Promise<void> {
  const marker = title === "Annual gross income" ? "Employed and contract income" : "Credit commitments";
  await page.locator("#AffordabilityCalculator").getByText(new RegExp(marker, "i")).first().waitFor({ state: "visible", timeout: 10000 });
}

async function isSantanderSection(page: Page, title: string): Promise<boolean> {
  const marker = title === "Commitments and expenditure" ? "Credit commitments" : "Employed and contract income";
  return page.locator("#AffordabilityCalculator").getByText(new RegExp(marker, "i")).first().isVisible().catch(() => false);
}

interface SantanderOtherPropertyCard {
  index: number;
  propertyValue: number;
  mortgageBalance: number;
  monthlyMortgagePayment: number;
  monthlyRent: number;
  remainingTermYears: number;
  interestOnlyBalance: number;
  isRental: boolean;
  repaymentType: RepaymentType;
  source: "otherProperties";
}

function santanderOtherPropertyCards(input: LenderReadyInput): SantanderOtherPropertyCard[] {
  return input.otherProperties.map((property, index) => ({
    index,
    propertyValue: Math.round(property.propertyValue),
    mortgageBalance: Math.round(property.currentBalance ?? 0),
    monthlyMortgagePayment: santanderOtherPropertyMonthlyPayment(property),
    monthlyRent: Math.round(property.monthlyRent ?? 0),
    remainingTermYears: Math.max(1, Math.round(property.remainingTermYears ?? input.case.termYears)),
    interestOnlyBalance: Math.round(property.interestOnlyBalance ?? 0),
    isRental: property.isRental,
    repaymentType: property.repaymentType ?? "capital_and_interest",
    source: "otherProperties"
  }));
}

async function fillNthAvailableCurrency(page: Page, labels: string[], itemIndex: number, value: number): Promise<boolean> {
  const textValue = String(Math.round(value));
  for (const label of labels) {
    const labelled = page.getByLabel(new RegExp(escapeRegExp(label), "i"));
    const labelledCount = await labelled.count();
    if (labelledCount > itemIndex) {
      const candidate = labelled.nth(itemIndex);
      if (await candidate.isVisible().catch(() => false)) {
        await candidate.fill(textValue, { force: true });
        return true;
      }
    }

    const afterLabel = page.locator(`xpath=.//*[contains(normalize-space(.), "${xpathLiteralText(label)}")]/following::input[1]`);
    const afterLabelCount = await afterLabel.count();
    if (afterLabelCount > itemIndex) {
      const candidate = afterLabel.nth(itemIndex);
      if (await candidate.isVisible().catch(() => false)) {
        await candidate.fill(textValue, { force: true });
        return true;
      }
    }
  }

  return false;
}

async function selectNthAvailableOption(page: Page, labels: string[], itemIndex: number, optionLabels: string[]): Promise<boolean> {
  for (const label of labels) {
    const labelled = page.getByLabel(new RegExp(escapeRegExp(label), "i"));
    const labelledCount = await labelled.count();
    if (labelledCount > itemIndex) {
      const candidate = labelled.nth(itemIndex);
      if (await candidate.isVisible().catch(() => false)) {
        if (await selectLocatorMatchingOption(candidate, optionLabels)) return true;
      }
    }

    const afterLabel = page.locator(`xpath=.//*[contains(normalize-space(.), "${xpathLiteralText(label)}")]/following::select[1]`);
    const afterLabelCount = await afterLabel.count();
    if (afterLabelCount > itemIndex) {
      const candidate = afterLabel.nth(itemIndex);
      if (await candidate.isVisible().catch(() => false)) {
        if (await selectLocatorMatchingOption(candidate, optionLabels)) return true;
      }
    }
  }

  return false;
}

async function selectFollowingSelectByLabelIndex(page: Page, label: string, selectIndex: number, optionLabels: string[]): Promise<boolean> {
  const select = page.locator(`xpath=.//*[contains(normalize-space(.), "${xpathLiteralText(label)}")]/following::select`);
  if (await select.count() <= selectIndex) return false;
  const candidate = select.nth(selectIndex);
  if (!(await candidate.isVisible().catch(() => false))) return false;
  return selectLocatorMatchingOption(candidate, optionLabels);
}

async function fillCurrencyAfterHeading(page: Page, heading: string, label: string, value: number): Promise<boolean> {
  const input = page.locator(
    `xpath=.//*[normalize-space(.)="${xpathLiteralText(heading)}"]/following::*[contains(normalize-space(.), "${xpathLiteralText(label)}")]/following::input[1]`
  );
  if (await input.count() === 0 || !(await input.first().isVisible().catch(() => false))) return false;
  await input.first().fill(String(Math.round(value)), { force: true });
  return true;
}

async function fillInputAfterText(page: Page, label: string, value: number): Promise<boolean> {
  return page.evaluate(
    ({ labelText, textValue }) => {
      const root = document.querySelector("#AffordabilityCalculator");
      if (!root) return false;
      const labelNode = Array.from(root.querySelectorAll("*")).find((element) =>
        Array.from(element.childNodes).some((node) =>
          node.nodeType === Node.TEXT_NODE && node.textContent?.replace(/\s+/g, " ").trim().includes(labelText)
        )
      );
      if (!labelNode) return false;
      const input = Array.from(root.querySelectorAll("input")).find((candidate) =>
        Boolean(labelNode.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        !!(candidate.offsetWidth || candidate.offsetHeight || candidate.getClientRects().length)
      );
      if (!input) return false;
      input.value = textValue;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    { labelText: label, textValue: String(Math.round(value)) }
  ).catch(() => false);
}

async function selectAfterHeading(
  page: Page,
  heading: string,
  label: string,
  optionLabels: string[],
  selectOffset = 0
): Promise<boolean> {
  const select = page.locator(
    `xpath=.//*[normalize-space(.)="${xpathLiteralText(heading)}"]/following::*[contains(normalize-space(.), "${xpathLiteralText(label)}")]/following::select`
  );
  if (await select.count() <= selectOffset) return false;
  const candidate = select.nth(selectOffset);
  if (!(await candidate.isVisible().catch(() => false))) return false;
  return selectLocatorMatchingOption(candidate, optionLabels);
}

async function selectLocatorMatchingOption(locator: ReturnType<Page["locator"]>, optionLabels: string[]): Promise<boolean> {
  const options = await locator.locator("option").evaluateAll((nodes) =>
    nodes.map((node, index) => ({
      index,
      label: node.textContent?.trim() ?? "",
      value: (node as HTMLOptionElement).value
    }))
  ).catch(() => []);

  for (const optionLabel of optionLabels) {
    const wanted = optionLabel.toLowerCase();
    const option = options.find((candidate) => {
      const label = candidate.label.toLowerCase();
      const value = candidate.value.toLowerCase();
      return label === wanted || value === wanted || label.includes(wanted);
    });
    if (option) {
      await locator.selectOption(option.value ? { value: option.value } : { index: option.index }, { force: true });
      return true;
    }
  }

  return false;
}

async function chooseOptionAfterQuestion(page: Page, question: string, option: string): Promise<boolean> {
  return chooseOptionAfterQuestionIndex(page, question, 0, option);
}

async function chooseOptionAfterQuestionIndex(page: Page, question: string, itemIndex: number, option: string): Promise<boolean> {
  await page
    .locator(`xpath=.//*[text()[contains(normalize-space(.), "${xpathLiteralText(question)}")]]`)
    .first()
    .waitFor({ state: "visible", timeout: 3000 })
    .catch(() => undefined);

  const optionButton = page.locator(
    `xpath=.//*[text()[contains(normalize-space(.), "${xpathLiteralText(question)}")]]/following::button[normalize-space(.)="${xpathLiteralText(option)}"]`
  );
  const visibleButton = await nthVisibleLocator(optionButton, itemIndex);
  if (visibleButton) {
    await visibleButton.click({ force: true });
    return true;
  }

  const optionText = page.locator(
    `xpath=.//*[text()[contains(normalize-space(.), "${xpathLiteralText(question)}")]]/following::*[normalize-space(.)="${xpathLiteralText(option)}"]`
  );
  const visibleText = await nthVisibleLocator(optionText, itemIndex);
  if (visibleText) {
    await visibleText.click({ force: true });
    return true;
  }

  return false;
}

async function nthVisibleLocator(locator: ReturnType<Page["locator"]>, visibleIndex: number): Promise<ReturnType<Page["locator"]> | null> {
  let seenVisible = 0;
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    const isUsable = await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false);
    if (!isUsable) continue;
    if (seenVisible === visibleIndex) return candidate;
    seenVisible += 1;
  }

  return null;
}

async function chooseOptionAfterHeadingQuestion(page: Page, heading: string, question: string, option: string): Promise<boolean> {
  const optionButton = page.locator(
    `xpath=.//*[normalize-space(.)="${xpathLiteralText(heading)}"]/following::*[text()[contains(normalize-space(.), "${xpathLiteralText(question)}")]]/following::button[normalize-space(.)="${xpathLiteralText(option)}"][1]`
  );
  if (await optionButton.count() > 0 && await optionButton.first().isVisible().catch(() => false)) {
    await optionButton.first().click({ force: true });
    return true;
  }

  return false;
}

async function chooseBorrowersSameAsCurrentMortgage(page: Page): Promise<void> {
  const prompts = page.getByText(/Are all borrowers the same as those named on the current mortgage/i);
  const promptCount = await prompts.count().catch(() => 0);
  for (let index = 0; index < promptCount; index += 1) {
    const prompt = prompts.nth(index);
    const yesCandidates = [
      prompt.locator('xpath=following::label[normalize-space(.)="Yes"][1]'),
      prompt.locator('xpath=following::button[normalize-space(.)="Yes"][1]'),
      prompt.locator('xpath=following::*[normalize-space(.)="Yes"][1]')
    ];
    for (const yes of yesCandidates) {
      if (await yes.count() > 0 && await yes.first().isVisible().catch(() => false)) {
        await yes.first().click({ force: true }).catch(() => undefined);
        break;
      }
    }
  }

  await page.evaluate(() => {
    const phrase = "Are all borrowers the same as those named on the current mortgage";
    const root = document.querySelector("#AffordabilityCalculator");
    if (!root) return;

    const promptNodes = Array.from(root.querySelectorAll("*")).filter((element) =>
      Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes(phrase))
    );

    for (const prompt of promptNodes) {
      const promptBox = prompt.getBoundingClientRect();
      const following = Array.from(root.querySelectorAll("button, [role='button'], label, span, div, a")) as HTMLElement[];
      const candidates = following.filter((element) => {
        const box = element.getBoundingClientRect();
        return Boolean(prompt.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          box.top >= promptBox.top &&
          box.top <= promptBox.top + 120;
      });
      const yes = candidates.find((element) => element.textContent?.trim() === "Yes");
      yes?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      yes?.click();
    }
  }).catch(() => undefined);
  await page.waitForTimeout(250);
}

async function chooseCombinedGrossIncomeOver200k(page: Page, option: "Yes" | "No"): Promise<void> {
  const clicked = await page.evaluate((wantedOption) => {
    const root = document.querySelector("#AffordabilityCalculator");
    if (!root) return false;

    const prompt = Array.from(root.querySelectorAll("*")).find((element) =>
      Array.from(element.childNodes).some((node) => {
        const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
        return node.nodeType === Node.TEXT_NODE &&
          /combined gross income/i.test(text) &&
          /200,000/.test(text);
      })
    );
    if (!prompt) return false;

    const promptBox = prompt.getBoundingClientRect();
    const controls = Array.from(root.querySelectorAll("button, [role='button'], label, span, div")) as HTMLElement[];
    const candidate = controls.find((element) => {
      const box = element.getBoundingClientRect();
      return element.textContent?.trim() === wantedOption &&
        Boolean(prompt.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        box.top >= promptBox.top &&
        box.top <= promptBox.top + 140 &&
        box.width > 0 &&
        box.height > 0;
    });

    if (!candidate) return false;
    candidate.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    candidate.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    candidate.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    candidate.click();
    return true;
  }, option).catch(() => false);

  if (!clicked) {
    await chooseOptionAfterQuestion(page, "combined gross income", option);
  }
  await page.waitForTimeout(250);
}

async function santanderFailureContext(page: Page): Promise<string> {
  const [routeName, heading, validationMessages] = await Promise.all([
    santanderRouteName(page),
    santanderCurrentHeading(page),
    santanderValidationMessages(page)
  ]);
  return `Route: ${routeName || "unknown"}. Heading: ${heading || "unknown"}. Validation messages: ${validationMessages}`;
}

async function santanderRouteName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const app = document.querySelector("#AffordabilityCalculator") as (Element & { __vue_app__?: { config?: { globalProperties?: { $route?: { name?: string } } } } }) | null;
    return app?.__vue_app__?.config?.globalProperties?.$route?.name ?? "";
  }).catch(() => "");
}

async function santanderCurrentHeading(page: Page): Promise<string> {
  return page
    .locator("#AffordabilityCalculator h1, #AffordabilityCalculator h2, #AffordabilityCalculator h3")
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "").find(Boolean) ?? "")
    .catch(() => "");
}

async function santanderValidationMessages(page: Page): Promise<string> {
  const messages = await page
    .locator("#AffordabilityCalculator .calculator-card_error-list, #AffordabilityCalculator .calculator_info-text--error")
    .allInnerTexts()
    .catch(() => []);
  return messages.map((message) => message.replace(/\s+/g, " ").trim()).filter(Boolean).join(" | ") || "none visible";
}

async function extractResult(page: Page): Promise<{
  maximumBorrowing: number | null;
  monthlyPayment: number | null;
  messages: string[];
}> {
  const resultState = await page.evaluate(() => {
    const app = document.querySelector("#AffordabilityCalculator") as (Element & { __vue_app__?: { config?: { globalProperties?: { $route?: { name?: string } } } } }) | null;
    const routeName = app?.__vue_app__?.config?.globalProperties?.$route?.name;
    const context = (app?.__vue_app__ as { _context?: { provides?: Record<PropertyKey, unknown> } } | undefined)?._context;
    const pinia = Reflect.ownKeys(context?.provides ?? {})
      .map((key) => context?.provides?.[key])
      .find((candidate): candidate is { state: { value: Record<string, Record<string, unknown>> } } =>
        !!candidate &&
        typeof candidate === "object" &&
        "state" in candidate &&
        !!(candidate as { state?: unknown }).state
      );
    const results = pinia?.state.value.results;
    return {
      routeName,
      result1Output: typeof results?.result1Output === "string" ? results.result1Output : "",
      result2Output: typeof results?.result2Output === "string" ? results.result2Output : "",
      resultText: typeof results?.resultText === "string" ? results.resultText : "",
      errorMessage: typeof results?.errorMessage === "string" ? results.errorMessage : "",
      errorList: Array.isArray(results?.errorList) ? results.errorList.map(String) : []
    };
  });

  if (resultState.routeName !== "Results") {
    const visibleCalculatorText = await page.locator("#AffordabilityCalculator").innerText().catch(() => "");
    return {
      maximumBorrowing: null,
      monthlyPayment: null,
      messages: resultMessages(visibleCalculatorText)
    };
  }

  const visibleResultText = await page.locator("#AffordabilityCalculator").innerText().catch(() => "");
  const visibleValidation = await santanderValidationMessages(page);
  const hasVisibleValidation = visibleValidation !== "none visible";
  const hasResultLanguage = /results?|borrow|lend|maximum|affordability/i.test(visibleResultText);
  if (hasVisibleValidation || !hasResultLanguage) {
    return {
      maximumBorrowing: null,
      monthlyPayment: null,
      messages: resultMessages([visibleValidation, visibleResultText].filter(Boolean).join("\n"))
    };
  }

  const resultText = [
    resultState.result1Output,
    resultState.result2Output,
    resultState.resultText,
    resultState.errorMessage,
    ...resultState.errorList
  ].filter(Boolean).join("\n");

  return {
    maximumBorrowing: extractMaximumCurrency(resultText) ?? extractMaximumCurrency(visibleResultText),
    monthlyPayment: null,
    messages: resultMessages(resultText || visibleResultText || await page.locator("body").innerText())
  };
}

async function setSantanderDetailsStore(page: Page, input: LenderReadyInput): Promise<void> {
  const details = {
    applicationType: input.case.numberOfApplicants === 1 ? "Single" : "Joint",
    dependants: input.household.dependants.length,
    mortgageType: input.case.mortgagePurpose === "purchase" ? "Purchase" : "Remortgage",
    remortgageReason: input.case.mortgagePurpose === "purchase" ? "" : remortgageReasonLabels[input.case.mortgagePurpose][0],
    existingSantanderCustomerYN: "No",
    depositOrEquity: Math.max(0, Math.round(input.loan.propertyValue - input.loan.loanAmount)),
    propertyValue: Math.round(input.loan.propertyValue),
    currentBalance: santanderCurrentBalance(input),
    repaymentMethod: santanderRepaymentMethodLabels(input)[0],
    interestOnlyAmt: Math.round(input.case.repaymentType === "capital_and_interest" ? 0 : input.case.interestOnlyLoanAmount ?? input.loan.loanAmount),
    capitalAndInterestAmt: Math.round(input.case.repaymentType === "interest_only" ? 0 : input.loan.loanAmount - (input.case.interestOnlyLoanAmount ?? 0)),
    oldestApplicantAge: oldestApplicantNextBirthdayAge(input),
    totalMonths: input.case.termYears * 12,
    mortgageTerm: input.case.termYears * 12
  };

  await page.evaluate(async (values) => {
    const app = document.querySelector("#AffordabilityCalculator") as (Element & { __vue_app__?: unknown }) | null;
    const context = (app?.__vue_app__ as { _context?: { provides?: Record<PropertyKey, unknown> } } | undefined)?._context;
    const pinia = Reflect.ownKeys(context?.provides ?? {})
      .map((key) => context?.provides?.[key])
      .find((candidate): candidate is { state: { value: Record<string, { details?: Record<string, unknown> } | Record<string, unknown>> } } =>
        !!candidate &&
        typeof candidate === "object" &&
        "state" in candidate &&
        !!(candidate as { state?: unknown }).state
      );
    const state = pinia?.state.value.details as Record<string, unknown> | undefined;
    if (!state) return;
    state.applicationType = values.applicationType;
    state.dependants = values.dependants;
    state.mortgageType = values.mortgageType;
    await new Promise((resolve) => setTimeout(resolve, 250));
    Object.assign(state, values);
    state.existingMortgageBalance = values.currentBalance;
    Object.assign(state, {
      allBorrowersSameAsCurrentMortgageYN: "Yes",
      allBorrowersSameYN: "Yes",
      borrowerSameYN: "Yes",
      borrowersSameYN: "Yes",
      borrowersSameAsCurrentMortgageYN: "Yes",
      currentMortgageBorrowersSameYN: "Yes",
      currentTotalBalance: values.currentBalance,
      currentTotalMortgageBalance: values.currentBalance,
      customerCurrentBalance: values.currentBalance
    });
  }, details);
}

async function setSantanderIncomeStore(page: Page, input: LenderReadyInput): Promise<void> {
  const applicants = input.applicants.map((applicant) => {
    const basic = Math.round(applicant.employment.annualGrossIncome ?? 0);
    const soleTraderLatest = Math.round(applicant.employment.netProfitCurrentYear ?? 0);
    const soleTraderPrevious = Math.round(applicant.employment.netProfitPreviousYear ?? soleTraderLatest);
    const privatePension = Math.round(applicant.employment.annualPensionIncome ?? 0);
    const statePension = Math.round(applicant.employment.otherAnnualPensionIncome ?? 0);
    const annualBonus1 = 0;
    const annualOvertime = 0;
    const annualCommission = 0;
    const otherIncome = Math.round(totalOtherIncome(applicant));
    const isSoleTrader = applicant.employment.type === "self_employed" && ["sole_trader", "partnership", "llp"].includes(applicant.employment.businessType ?? "sole_trader");
    const isDirector = applicant.employment.type === "self_employed" && applicant.employment.businessType === "limited_company";
    const selfEmploymentIncome = isDirector ? basic + soleTraderLatest : isSoleTrader ? soleTraderLatest : 0;
    const employedIncome = applicant.employment.type === "self_employed" ? 0 : basic;
    const nonRegularIncome = annualBonus1 + annualOvertime + annualCommission;
    const regularIncome = employedIncome + selfEmploymentIncome + privatePension + statePension + otherIncome;
    const taxableGrossIncome = regularIncome + nonRegularIncome;
    const monthlyNet = estimateMonthlyNetIncome(taxableGrossIncome);

    return {
      index: applicant.index,
      basic,
      employedIncome,
      soleTraderLatest,
      soleTraderPrevious,
      privatePension,
      statePension,
      annualBonus1,
      annualOvertime,
      annualCommission,
      otherIncome,
      nonRegularIncome,
      regularIncome,
      taxableGrossIncome,
      monthlyNet,
      isSoleTrader,
      isDirector
    };
  });

  await page.evaluate((values) => {
    const app = document.querySelector("#AffordabilityCalculator") as (Element & { __vue_app__?: unknown }) | null;
    const context = (app?.__vue_app__ as { _context?: { provides?: Record<PropertyKey, unknown> } } | undefined)?._context;
    const pinia = Reflect.ownKeys(context?.provides ?? {})
      .map((key) => context?.provides?.[key])
      .find((candidate): candidate is { state: { value: Record<string, Record<string, unknown>> } } =>
        !!candidate &&
        typeof candidate === "object" &&
        "state" in candidate &&
        !!(candidate as { state?: unknown }).state
      );
    const income = pinia?.state.value.income as Record<string, Record<string, unknown>> | undefined;
    if (!income) return;

    for (const applicant of values) {
      const target = income[`applicant${applicant.index}`];
      if (!target) continue;
      Object.assign(target, {
        basic: applicant.basic,
        mainAnnualIncome: applicant.basic,
        grossIncome: applicant.taxableGrossIncome,
        taxableGrossIncome: applicant.taxableGrossIncome,
        annualTaxable: applicant.taxableGrossIncome,
        annualNontaxable: 0,
        monthlyTaxable: Math.round(applicant.taxableGrossIncome / 12),
        monthlyNonTax: 0,
        monthlyNet: applicant.monthlyNet,
        netIncomeCalc: applicant.monthlyNet,
        grossBasic: applicant.regularIncome,
        grossBasicModified: applicant.regularIncome,
        grossNonRegular: applicant.nonRegularIncome,
        grossNonRegularModified: applicant.nonRegularIncome,
        soleTraderLatest: applicant.soleTraderLatest,
        soleTraderPrevious: applicant.soleTraderPrevious,
        soleTraderIncome: applicant.isSoleTrader ? Math.round((applicant.soleTraderLatest + applicant.soleTraderPrevious) / 2) : 0,
        soleTraderYN: applicant.isSoleTrader ? "Yes" : "No",
        directorYN: applicant.isDirector ? "Yes" : "No",
        directorSalaryLatest: applicant.isDirector ? applicant.basic : 0,
        directorSalaryPrevious: applicant.isDirector ? applicant.basic : 0,
        directorSalaryIncome: applicant.isDirector ? applicant.basic : 0,
        dividendsLatest: applicant.isDirector ? applicant.soleTraderLatest : 0,
        dividendsPrevious: applicant.isDirector ? applicant.soleTraderPrevious : 0,
        dividendsIncome: applicant.isDirector ? Math.round((applicant.soleTraderLatest + applicant.soleTraderPrevious) / 2) : 0,
        totalLatest: applicant.isDirector ? applicant.basic + applicant.soleTraderLatest : 0,
        totalPrevious: applicant.isDirector ? applicant.basic + applicant.soleTraderPrevious : 0,
        totalAverage: applicant.isDirector ? Math.round((applicant.basic + applicant.soleTraderLatest + applicant.basic + applicant.soleTraderPrevious) / 2) : 0,
        privatePension: applicant.privatePension,
        statePension: applicant.statePension,
        bonusYN: applicant.annualBonus1 + applicant.annualCommission > 0 ? "Yes" : "No",
        bonusMonthlyYN: "No",
        bonusFreq: applicant.annualBonus1 + applicant.annualCommission > 0 ? "Other" : "",
        annualBonus1: applicant.annualBonus1,
        annualBonus2: 0,
        annualBonus3: applicant.annualBonus1 + applicant.annualCommission,
        bonusEntered: applicant.annualBonus1 + applicant.annualCommission > 0,
        primaryBonus: applicant.annualBonus1 + applicant.annualCommission,
        secondaryBonus: 0,
        bonusCalcFinal: applicant.annualBonus1 + applicant.annualCommission,
        bonusAnnualFinal: applicant.annualBonus1 + applicant.annualCommission,
        overtimeYN: applicant.annualOvertime > 0 ? "Yes" : "No",
        overtimeMonthlyYN: "No",
        overtimeCalcType: applicant.annualOvertime > 0 ? "Other" : "",
        annualOvertime: applicant.annualOvertime,
        overtimeEntered: applicant.annualOvertime > 0,
        primaryOvertime: applicant.annualOvertime,
        secondaryOvertime: 0,
        overtimeCalcFinal: applicant.annualOvertime,
        annualCommission: applicant.annualCommission,
        otherIncomeYN: "No",
        otherAnnualIncome: applicant.otherIncome
      });
    }
  }, applicants);
}

function estimateMonthlyNetIncome(annualGrossIncome: number): number {
  if (annualGrossIncome <= 0) return 0;

  const personalAllowance = annualGrossIncome > 125140 ? 0 : Math.max(0, 12570 - Math.max(0, annualGrossIncome - 100000) / 2);
  const taxable = Math.max(0, annualGrossIncome - personalAllowance);
  const basicRateTax = Math.min(taxable, 37700) * 0.2;
  const higherRateTax = Math.min(Math.max(0, taxable - 37700), 87440) * 0.4;
  const additionalRateTax = Math.max(0, taxable - 125140) * 0.45;
  const nationalInsurance = Math.max(0, Math.min(annualGrossIncome, 50270) - 12570) * 0.08 + Math.max(0, annualGrossIncome - 50270) * 0.02;

  return Math.round((annualGrossIncome - basicRateTax - higherRateTax - additionalRateTax - nationalInsurance) / 12);
}

function dependantOption(count: number): string {
  if (count >= 21) return "21+";
  return String(Math.max(0, count));
}

function oldestApplicantNextBirthdayAge(input: LenderReadyInput): number {
  return Math.max(...input.applicants.map((applicant) => applicant.age + 1));
}

function totalApplicantsGrossIncome(input: LenderReadyInput): number {
  return input.applicants.reduce((sum, applicant) => {
    const employment = applicant.employment;
    return sum +
      (employment.annualGrossIncome ?? 0) +
      (employment.annualPensionIncome ?? 0) +
      (employment.otherAnnualPensionIncome ?? 0) +
      (employment.netProfitCurrentYear ?? 0) +
      totalOtherIncome(applicant);
  }, 0);
}

function santanderCurrentBalance(input: LenderReadyInput): number {
  return Math.round(input.loan.currentBalance ?? input.loan.loanAmount);
}

function santanderRepaymentMethodLabels(input: LenderReadyInput): string[] {
  if (input.case.repaymentType === "part_and_part" && input.case.mortgagePurpose !== "purchase") {
    return [
      "Part and part - endowment or investment",
      "Part and part - sale of mortgaged property"
    ];
  }

  return repaymentMethodLabels[input.case.repaymentType];
}

function loanToValue(input: LenderReadyInput): number {
  if (input.loan.propertyValue <= 0) return 0;
  return input.loan.loanAmount / input.loan.propertyValue;
}

function santanderOtherPropertyMonthlyPayment(property: LenderReadyInput["otherProperties"][number]): number {
  const enteredPayment = Math.round(property.monthlyMortgagePayment);
  const termMonths = Math.max(1, Math.round(property.remainingTermYears ?? 1) * 12);
  const capitalBalance = Math.max(0, Math.round((property.currentBalance ?? 0) - (property.interestOnlyBalance ?? 0)));
  if ((property.repaymentType ?? "capital_and_interest") === "interest_only") return enteredPayment;
  return Math.max(enteredPayment, Math.ceil(capitalBalance / termMonths));
}

function totalOtherIncome(applicant: Applicant): number {
  return applicant.otherIncome.reduce((sum, income) => sum + income.annualAmount, applicant.employment.otherAnnualPensionIncome ?? 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function xpathLiteralText(value: string): string {
  return value.replace(/"/g, '\\"');
}
