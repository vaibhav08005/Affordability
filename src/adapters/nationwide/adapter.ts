import type { Page } from "playwright";
import type { AffordabilityResult, Applicant, LenderReadyInput, OtherMortgageCommitment, OtherProperty } from "../../domain/contracts.js";
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
  applicationTypeValues,
  contractTypeValues,
  customerTypeValues,
  employmentCategoryValues,
  NATIONWIDE_CALCULATOR_URL,
  ownershipTypeValues,
  repaymentMethodValues,
  selfEmploymentCategoryValues,
  tenureValues
} from "./mapping.js";

export const nationwideAdapter: LenderAdapter = {
  lender: "nationwide",
  async run(input, context) {
    const startedAt = new Date().toISOString();
    const session = await createBrowserSession(context, NATIONWIDE_CALCULATOR_URL);
    const page = session.page;
    page.setDefaultTimeout(context.timeoutMs);
    page.setDefaultNavigationTimeout(context.timeoutMs);

    try {
      await openNationwideCalculator(page, context);
      await fillNationwideCalculator(page, input);
      await waitForResult(page, context);

      const result = await extractResult(page);
      if (result.maximumBorrowing == null) {
        throw new Error("Result extraction failed: Nationwide did not return a maximum borrowing amount.");
      }

      const screenshotPath = await captureEvidence(page, context, "nationwide-success");
      return {
        lender: "nationwide",
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
      const screenshotPath = await captureEvidence(page, context, "nationwide-failed").catch(() => undefined);
      return {
        lender: "nationwide",
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

async function openNationwideCalculator(page: Page, context: RunContext): Promise<void> {
  await page.goto(NATIONWIDE_CALCULATOR_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  await clickFirstAvailableButton(page, [
    "Allow all cookies",
    "Allow essential cookies only",
    "Accept all cookies",
    "Accept cookies"
  ]).catch(() => undefined);
  await page
    .locator(".Affordability, form[data-module='MortgageAffordability'], body")
    .first()
    .waitFor({ state: "visible", timeout: Math.min(context.timeoutMs, 20000) });
  await clickFirstAvailableButton(page, [
    "Allow all cookies",
    "Allow essential cookies only",
    "Accept all cookies",
    "Accept cookies"
  ]).catch(() => undefined);
  await page.waitForTimeout(1000);
}

async function fillNationwideCalculator(page: Page, input: LenderReadyInput): Promise<void> {
  await fillMortgageStep(page, input);
  await advance(page);
  await page.getByText(/About your client/i).first().waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
  await fillClientsStep(page, input);
  await advance(page);
  await page.locator("#AffCalc-q240-EmploymentCategory").waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
  await fillIncomeStep(page, input);
  await advance(page);
  await page.getByText(/Outgoings/i).first().waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
  await fillOutgoingsStep(page, input);
  await page.waitForTimeout(2000);
  await clickFirstAvailableButton(page, ["Calculate", "Get results", "See results", "Next"]);
}

async function fillMortgageStep(page: Page, input: LenderReadyInput): Promise<void> {
  await selectFirstAvailableOption(page, ["What's the mortgage for?", "ApplicationType"], [applicationTypeValues[input.case.mortgagePurpose]]);
  await chooseFirstAvailableOption(page, applicationTypeLabels(input), ["What's the mortgage for?"]);
  await selectFirstAvailableOption(page, ["What type of mortgage?", "RepaymentMethod"], [repaymentMethodValues[input.case.repaymentType]]);
  await chooseFirstAvailableOption(page, repaymentMethodLabels(input.case.repaymentType), ["What type of mortgage?"]);
  await checkRadioById(page, "AffCalc-q4-MainResidence-0");
  await chooseFirstAvailableOption(page, [String(input.case.numberOfApplicants)], ["How many people are applying?"]);
  await checkRadioById(page, input.case.mortgagePurpose === "remortgage_capital_raising"
    ? "AffCalc-q15-RemortagingToRepayDebts-0"
    : "AffCalc-q15-RemortagingToRepayDebts-1");

  await fillFirstAvailableCurrency(page, ["How much would your client(s) like to borrow?", "Borrowing amount", "BorrowingAmount"], input.loan.loanAmount);
  if (input.case.mortgagePurpose === "further_advance") {
    await fillFirstAvailableCurrency(page, ["How much extra would your client(s) like to borrow?"], input.loan.loanAmount);
    await fillFurtherAdvanceExistingMortgage(page, input);
  }
  if (input.case.mortgagePurpose !== "purchase") {
    await fillFirstAvailableCurrency(page, ["Amount transferred from other lender"], input.loan.loanAmount);
  }
  if (input.case.repaymentType !== "capital_and_interest") {
    await fillFirstAvailableCurrency(page, ["interest only loan amount"], input.case.interestOnlyLoanAmount ?? 0);
    await fillFirstAvailableCurrency(page, ["repayment loan amount"], input.loan.loanAmount - (input.case.interestOnlyLoanAmount ?? 0));
  }
  await fillTerm(page, ["How long does the mortgage term need to be?", "Mortgage term"], input.case.termYears);

  const ownershipValue = input.case.sharedOwnershipOrEquity
    ? ownershipTypeValues[input.case.sharedOwnershipScheme ?? "shared_ownership"]
    : ownershipTypeValues.standard;
  await selectFirstAvailableOption(page, ["What type of ownership will it be?", "OwnershipType"], [ownershipValue]);
  if (input.case.sharedOwnershipOrEquity) {
    await fillFirstAvailableCurrency(page, ["full market value", "MarketValue"], input.loan.propertyValue);
  }
  if (input.case.mortgagePurpose === "purchase") {
    await chooseFirstAvailableOption(page, ["Yes"], ["found a new home"]);
  }
  await selectFirstAvailableOption(page, ["property's legal status", "PropertyTenure"], [tenureValues[input.property.tenure]]);
  await selectVisibleById(page, "AffCalc-q80-PropertyType", "Detached house") ||
    await selectFirstAvailableOption(page, ["What sort of property is it?", "PropertyType"], ["Detached house"]);
  await selectFirstAvailableOption(page, ["property based", "Region"], [input.property.isInScotland ? "Scotland" : "NotKnown"]);
  await checkRadioById(page, input.property.isInScotland ? "AffCalc-q135-Region-0" : "AffCalc-q135-Region-1");
  await checkRadioById(page, "AffCalc-q4-MainResidence-0");
  await fillFirstAvailableCurrency(page, ["purchase price", "PurchasePrice"], input.loan.propertyValue);
  await fillFirstAvailableCurrency(page, ["current estimated value", "CurrentEstimatedValue"], input.loan.propertyValue);
}

async function fillFurtherAdvanceExistingMortgage(page: Page, input: LenderReadyInput): Promise<void> {
  const existingMortgage = input.outgoings.otherMortgageCommitments[0];
  const existingTermYears = Math.max(input.case.termYears, existingMortgage?.remainingTermYears ?? input.case.termYears);
  const existingBalance = input.loan.currentBalance ?? existingMortgage?.outstandingBalance ?? 0;

  await checkRadioById(page, "AffCalc-q42-BorrowMoreTermMatchesExisting-0");
  await setInputValueById(page, "AffCalc-q44-ExistingMortgageTermYears", String(existingTermYears));
  await setInputValueById(page, "AffCalc-q44-ExistingMortgageTermMonths", "0");
  await setInputValueById(page, "AffCalc-q46-ExistingMortgageBalance", String(Math.round(existingBalance)));
  await setInputValueById(page, "AffCalc-q48-ExistingInterestOnlyMortgageBalance", String(Math.round(input.case.interestOnlyLoanAmount ?? 0)));
}

async function fillClientsStep(page: Page, input: LenderReadyInput): Promise<void> {
  await page.locator('input[placeholder="DD"], input[placeholder="D"]').first().waitFor({ state: "visible", timeout: 15000 });
  for (const applicant of input.applicants) {
    await fillDateOfBirth(page, applicant);
    await selectVisibleById(page, applicant.index === 1 ? "AffCalc-q145-PropertyTenure" : "AffCalc-q195-JointApplicant-CustomerType", customerTypeValues[input.case.customerType]);
    await checkRadioById(page, applicant.index === 1
      ? input.household.dependants.length > 0 ? "AffCalc-q150-HaveDependents-0" : "AffCalc-q150-HaveDependents-1"
      : input.household.dependants.length > 0 ? "AffCalc-q200-HaveDependents-0" : "AffCalc-q200-HaveDependents-1");
    await fillDependantBands(page, input, applicant.index);
    await checkRadioById(page, applicant.index === 1
      ? applicant.employment.type === "pension" ? "AffCalc-q170-IsCustomerRetired-0" : "AffCalc-q170-IsCustomerRetired-1"
      : applicant.employment.type === "pension" ? "AffCalc-q220-IsCustomerRetired-0" : "AffCalc-q220-IsCustomerRetired-1");
    await fillVisibleById(page, applicant.index === 1 ? "AffCalc-q180-RetirementAge" : "AffCalc-q230-RetirementAge", String(applicant.retirementAge ?? 70));
    await setClientValuesById(page, applicant);
  }
}

async function fillIncomeStep(page: Page, input: LenderReadyInput): Promise<void> {
  for (const applicant of input.applicants) {
    await fillApplicantIncome(page, applicant);
  }
  if (input.case.repaymentType !== "capital_and_interest") {
    await fillInterestOnlyRepaymentPlan(page, input);
  }
}

async function fillApplicantIncome(page: Page, applicant: Applicant): Promise<void> {
  const employmentValue =
    applicant.employment.type === "self_employed" && applicant.employment.businessType
      ? selfEmploymentCategoryValues[applicant.employment.businessType]
      : employmentCategoryValues[applicant.employment.type];
  const employmentCategoryId = applicant.index === 1 ? "AffCalc-q240-EmploymentCategory" : "AffCalc-q780-EmploymentCategory";
  await page.locator(`#${employmentCategoryId}`).waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
  if (!(await setSelectValueById(page, employmentCategoryId, employmentValue))) {
    await selectFirstAvailableOption(page, ["How is your client employed?", "EmploymentCategory"], [employmentValue]);
  }

  const contractValue = applicant.employment.isContractor ? contractTypeValues.fixed_term : contractTypeValues.permanent;
  const contractTypeId = applicant.index === 1 ? "AffCalc-q250-EmploymentType" : "AffCalc-q790-EmploymentType";
  if (!(await setSelectValueById(page, contractTypeId, contractValue))) {
    await selectFirstAvailableOption(page, ["What type of contract are they on?", "EmploymentType"], [contractValue]);
  }
  await checkRadioById(page, applicant.index === 1
    ? applicant.employment.isContractor ? "AffCalc-q260-TreatedAsEmployedForTax-0" : "AffCalc-q260-TreatedAsEmployedForTax-1"
    : applicant.employment.isContractor ? "AffCalc-q800-TreatedAsEmployedForTax-0" : "AffCalc-q800-TreatedAsEmployedForTax-1");
  if (applicant.index === 1 && applicant.employment.isContractor) {
    await setInputValueById(page, "AffCalc-q300-ContractYears", "2");
    await setInputValueById(page, "AffCalc-q300-ContractMonths", "0");
    await setInputValueById(page, "AffCalc-q310-ContractYears", "1");
    await setInputValueById(page, "AffCalc-q310-ContractMonths", "0");
  } else if (applicant.index === 1 && applicant.employment.type === "self_employed") {
    await setInputValueById(page, "AffCalc-q280-BusinessYears", "2");
    await setInputValueById(page, "AffCalc-q280-BusinessMonths", "0");
  } else if (applicant.index === 1) {
    await setInputValueById(page, "AffCalc-q270-JobYears", "2");
    await setInputValueById(page, "AffCalc-q270-JobMonths", "0");
  } else if (applicant.employment.isContractor) {
    await setInputValueById(page, "AffCalc-q840-ContractYears", "2");
    await setInputValueById(page, "AffCalc-q840-ContractMonths", "0");
    await setInputValueById(page, "AffCalc-q850-ContractYears", "1");
    await setInputValueById(page, "AffCalc-q850-ContractMonths", "0");
  } else if (applicant.employment.type === "self_employed") {
    await setInputValueById(page, "AffCalc-q820-BusinessYears", "2");
    await setInputValueById(page, "AffCalc-q820-BusinessMonths", "0");
  } else {
    await setInputValueById(page, "AffCalc-q810-JobYears", "2");
    await setInputValueById(page, "AffCalc-q810-JobMonths", "0");
  }
  const ids = applicant.index === 1
    ? { gross: "AffCalc-q320-GrossAnnualIncome", bonus: "AffCalc-q330-Bonus", bonusFrequency: "AffCalc-q335-BonusFrequency", overtime: "AffCalc-q340-Overtime", overtimeFrequency: "AffCalc-q345-OvertimeFrequency", commission: "AffCalc-q350-Commission", commissionFrequency: "AffCalc-q355-CommissionFrequency", latestProfit: "AffCalc-q360-LatestPeriodProfit", previousProfit: "AffCalc-q370-PreviousPeriodProfit", latestProfitShare: "AffCalc-q380-LatestPeriodProfitShare", previousProfitShare: "AffCalc-q390-PreviousPeriodProfitShare", latestSalary: "AffCalc-q400-LatestPeriodSalary", previousSalary: "AffCalc-q410-PreviousPeriodSalary" }
    : { gross: "AffCalc-q860-GrossAnnualIncome", bonus: "AffCalc-q870-Bonus", bonusFrequency: "AffCalc-q875-BonusFrequency", overtime: "AffCalc-q880-Overtime", overtimeFrequency: "AffCalc-q885-OvertimeFrequency", commission: "AffCalc-q890-Commission", commissionFrequency: "AffCalc-q895-CommissionFrequency", latestProfit: "AffCalc-q900-LatestPeriodProfit", previousProfit: "AffCalc-q910-PreviousPeriodProfit", latestProfitShare: "AffCalc-q920-LatestPeriodProfitShare", previousProfitShare: "AffCalc-q930-PreviousPeriodProfitShare", latestSalary: "AffCalc-q940-LatestPeriodSalary", previousSalary: "AffCalc-q950-PreviousPeriodSalary" };
  await setInputValueById(page, ids.gross, String(Math.round(applicant.employment.annualGrossIncome ?? 0)));
  await setInputValueById(page, ids.bonus, String(Math.round(applicant.employment.annualBonus ?? 0)));
  await setSelectValueById(page, ids.bonusFrequency, "1");
  await setInputValueById(page, ids.overtime, String(Math.round(applicant.employment.annualOvertime ?? 0)));
  await setSelectValueById(page, ids.overtimeFrequency, "1");
  await setInputValueById(page, ids.commission, String(Math.round(applicant.employment.annualCommission ?? 0)));
  await setSelectValueById(page, ids.commissionFrequency, "1");
  await setInputValueById(page, ids.latestProfit, String(Math.round(applicant.employment.netProfitCurrentYear ?? 0)));
  await setInputValueById(page, ids.previousProfit, String(Math.round(applicant.employment.netProfitPreviousYear ?? 0)));
  await setInputValueById(page, ids.latestProfitShare, String(Math.round(applicant.employment.netProfitCurrentYear ?? 0)));
  await setInputValueById(page, ids.previousProfitShare, String(Math.round(applicant.employment.netProfitPreviousYear ?? 0)));
  await setInputValueById(page, ids.latestSalary, String(Math.round(directorIncome(applicant, "current"))));
  await setInputValueById(page, ids.previousSalary, String(Math.round(directorIncome(applicant, "previous"))));
  await checkRadioById(page, applicant.index === 1 ? "AffCalc-q420-HasSecondJob-1" : "AffCalc-q960-HasSecondJob-1");
  await checkRadioById(page, applicant.index === 1
    ? hasOtherIncome(applicant) ? "AffCalc-q610-HasOtherIncome-0" : "AffCalc-q610-HasOtherIncome-1"
    : hasOtherIncome(applicant) ? "AffCalc-q1150-HasOtherIncome-0" : "AffCalc-q1150-HasOtherIncome-1");
  await fillNationwideOtherIncome(page, applicant);
  await chooseFirstAvailableOption(page, ["No"], ["sell their main residence"]);
}

async function fillInterestOnlyRepaymentPlan(page: Page, input: LenderReadyInput): Promise<void> {
  await checkRadioById(page, "AffCalc-q2000-SaleOfMainResidence-1");

  const repaymentSourceValue = input.otherProperties.length > 0 ? "SaleOfOtherUkProperty" : "UkSavings";
  await checkCheckboxById(page, `AffCalc-q2005-${repaymentSourceValue}`);
  await checkCheckboxById(page, `AffCalc-q3005-${repaymentSourceValue}`);

  if (input.otherProperties.length > 0) {
    const totalValue = input.otherProperties.reduce((sum, property) => sum + property.propertyValue, 0);
    const totalBalance = input.otherProperties.reduce((sum, property) => sum + (property.currentBalance ?? 0), 0);
    await setInputValueById(page, "AffCalc-q2010-SaleOfOtherUKProperty", String(Math.round(totalValue)));
    await setInputValueById(page, "AffCalc-q2020-OtherUKPropertyMortgageBalance", String(Math.round(totalBalance)));
    await setInputValueById(page, "AffCalc-q3010-JointApplicant-InterestOnly-SaleOfOtherUKProperty", String(Math.round(totalValue)));
    await setInputValueById(page, "AffCalc-q3020-InterestOnly-OtherUKPropertyMortgageBalance", String(Math.round(totalBalance)));
  } else {
    const savingsAmount = Math.max(input.case.interestOnlyLoanAmount ?? input.loan.loanAmount, input.loan.loanAmount);
    await setInputValueById(page, "AffCalc-q2030-UKSavings", String(Math.round(savingsAmount)));
    await setInputValueById(page, "AffCalc-q3030-InterestOnly-UKSavings", String(Math.round(savingsAmount)));
  }
}

async function fillNationwideOtherIncome(page: Page, applicant: Applicant): Promise<void> {
  const ids = applicant.index === 1
    ? {
        investment: "AffCalc-q700-AnnualInvestmentIncome",
        mortgageFreeRent: "AffCalc-q710-AnnualMortgageFreeRentalIncome",
        disability: "AffCalc-q720-AnnualStateDisabilityBenefit",
        universalCredit: "AffCalc-q730-AnnualUniversalCredit",
        childBenefit: "AffCalc-q740-AnnualChildBenefit",
        maintenance: "AffCalc-q750-AnnualMaintenanceIncome",
        monthlyPension: "AffCalc-q680-MonthlyPensionIncome",
        pension: "AffCalc-q760-AnnualPensionIncome"
      }
    : {
        investment: "AffCalc-q1240-AnnualInvestmentIncome",
        mortgageFreeRent: "AffCalc-q1250-AnnualMortgageFreeRentalIncome",
        disability: "AffCalc-q1260-AnnualStateDisabilityBenefit",
        universalCredit: "AffCalc-q1270-AnnualUniversalCredit",
        childBenefit: "AffCalc-q1280-AnnualChildBenefit",
        maintenance: "AffCalc-q1290-AnnualMaintenanceIncome",
        monthlyPension: "AffCalc-q1220-MonthlyPensionIncome",
        pension: "AffCalc-q1300-AnnualPensionIncome"
      };

  await setInputValueById(page, ids.investment, "0");
  await setInputValueById(page, ids.mortgageFreeRent, "0");
  await setInputValueById(page, ids.disability, "0");
  await setInputValueById(page, ids.universalCredit, String(Math.round(otherIncomeAnnualTotal(applicant, "universal_credit"))));
  await setInputValueById(page, ids.childBenefit, String(Math.round(otherIncomeAnnualTotal(applicant, "child_benefit"))));
  await setInputValueById(page, ids.maintenance, String(Math.round(otherIncomeAnnualTotal(applicant, "maintenance"))));
  await setInputValueById(page, ids.monthlyPension, String(Math.round(totalAnnualPensionIncome(applicant) / 12)));
  await setInputValueById(page, ids.pension, String(Math.round(applicant.employment.annualPensionIncome ?? 0)));
}

async function fillOutgoingsStep(page: Page, input: LenderReadyInput): Promise<void> {
  await fillFirstAvailableCurrency(page, ["total your client owes on all credit cards", "TotalCreditCardBalances"], input.outgoings.creditCardBalances);
  await fillFirstAvailableCurrency(page, ["how much will be cleared", "TotalCreditCardBalanceToBeCleared"], 0);
  await chooseFirstAvailableOption(page, ["No"], ["credit cards cleared in full"]);
  await fillFirstAvailableCurrency(page, ["Personal loans and hire purchases", "MonthlyPersonalLoanOrHire"], input.outgoings.monthlyLoanRepayments);
  await fillFirstAvailableCurrency(page, ["Secured loan payments", "MonthlySecuredLoanPayments"], 0);
  await fillFirstAvailableCurrency(page, ["Buy now, pay later", "MonthlyDpaPayment"], 0);
  await fillFirstAvailableCurrency(page, ["Student loan payments", "MonthlyStudentLoan"], 0);
  await fillFirstAvailableCurrency(page, ["Travel?", "MonthlyTravelCosts"], 0);
  await fillFirstAvailableCurrency(page, ["Other regular monthly costs", "MonthlyOtherExpenditure"], input.outgoings.otherMonthlyOutgoings);
  await fillFirstAvailableCurrency(page, ["Childcare?", "MonthlyChildCare"], 0);
  await fillFirstAvailableCurrency(page, ["School fees?", "MonthlySchoolFees"], 0);
  await fillFirstAvailableCurrency(page, ["Maintenance?", "MonthlyDependentMaintenance"], 0);
  await fillFirstAvailableCurrency(page, ["additional costs for financial dependants", "MonthlyCostOfFinancialDependents"], 0);
  await fillFirstAvailableCurrency(page, ["Council tax?", "CouncilTax"], 0);
  await fillFirstAvailableCurrency(page, ["Buildings insurance?", "BuildingInsurance"], 1);
  await fillFirstAvailableCurrency(page, ["Service/Estate charges?", "ServiceCharge"], 0);
  await fillFirstAvailableCurrency(page, ["Ground rent?", "GroundRent"], 0);
  await fillFirstAvailableCurrency(page, ["Rent for shared ownership properties?", "SharedOwnershipRental"], input.case.monthlySharedOwnershipRent ?? 0);
  await fillExistingMortgages(page, input);
}

async function fillExistingMortgages(page: Page, input: LenderReadyInput): Promise<void> {
  const hasMortgages = input.otherProperties.length > 0 || input.outgoings.otherMortgageCommitments.length > 0;
  await checkRadioById(page, hasMortgages ? "AffCalc-q1540-HasExistingMortgages-0" : "AffCalc-q1540-HasExistingMortgages-1");
  await checkRadioById(page, "AffCalc-q1590-HasExistingMortgages-1");
  await setSelectValueById(page, "AffCalc-q1550-NoOfJointMortgages", String(Math.min(input.outgoings.otherMortgageCommitments.length, 6)));
  await setSelectValueById(page, "AffCalc-q1570-NoOfExistingMortgages", String(Math.min(input.otherProperties.length, 6)));
  await setSelectValueById(page, "AffCalc-q1600-NoOfExistingMortgages", "0");

  for (const [index, property] of input.otherProperties.slice(0, 6).entries()) {
    await fillOtherPropertyMortgageCard(page, property, index);
  }
  for (const [index, mortgage] of input.outgoings.otherMortgageCommitments.slice(0, 6).entries()) {
    await fillOtherMortgageCommitmentFields(page, mortgage, index);
  }
}

async function fillOtherMortgageCommitmentFields(page: Page, mortgage: OtherMortgageCommitment, index: number): Promise<void> {
  await page.locator("#AffCalc-q1560-0-0-TotalBalance, #AffCalc-q1580-0-0-TotalBalance").first().waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
  for (const prefix of ["AffCalc-q1560", "AffCalc-q1580"]) {
    await setInputValueById(page, `${prefix}-${index}-0-TotalBalance`, String(Math.round(mortgage.outstandingBalance)));
    await setInputValueById(page, `${prefix}-${index}-1-InterestOnlyBalance`, "0");
    await setInputValueById(page, `${prefix}-${index}-2-RemainingTermOfLoanYY`, String(Math.max(0, mortgage.remainingTermYears)));
    await setInputValueById(page, `${prefix}-${index}-2-RemainingTermOfLoanMM`, "0");
    await checkRadioById(page, `${prefix}-${index}-3-PropertyLet-1`);
    await checkRadioById(page, `${prefix}-${index}-4-HasTenancyAgreement-1`);
    await setInputValueById(page, `${prefix}-${index}-5-MonthlyRentalIncome`, "0");
    await setInputValueById(page, `${prefix}-${index}-6-MonthlyPayments`, "0");
  }
}

async function fillOtherPropertyMortgageCard(page: Page, property: OtherProperty, index: number): Promise<void> {
  const prefix = "AffCalc-q1580";
  await setInputValueById(page, `${prefix}-${index}-0-TotalBalance`, String(Math.round(property.currentBalance ?? 0)));
  await setInputValueById(page, `${prefix}-${index}-1-InterestOnlyBalance`, String(Math.round(property.interestOnlyBalance ?? 0)));
  await setInputValueById(page, `${prefix}-${index}-2-RemainingTermOfLoanYY`, String(Math.max(0, property.remainingTermYears ?? 0)));
  await setInputValueById(page, `${prefix}-${index}-2-RemainingTermOfLoanMM`, "0");
  await checkRadioById(page, `${prefix}-${index}-3-PropertyLet-${property.isRental ? "0" : "1"}`);
  await checkRadioById(page, `${prefix}-${index}-4-HasTenancyAgreement-${property.isRental ? "0" : "1"}`);
  await setInputValueById(page, `${prefix}-${index}-5-MonthlyRentalIncome`, String(Math.round(property.monthlyRent ?? 0)));
  await setInputValueById(page, `${prefix}-${index}-6-MonthlyPayments`, String(Math.round(property.monthlyMortgagePayment)));
}

async function fillOtherMortgageFields(page: Page, property: OtherProperty): Promise<void> {
  await fillFirstAvailableCurrency(page, ["total balance", "TotalBalance"], property.currentBalance ?? 0);
  await fillFirstAvailableCurrency(page, ["interest-only balance", "InterestOnlyBalance"], property.interestOnlyBalance ?? 0);
  await fillTerm(page, ["remaining term of the loan", "RemainingTermOfLoan"], property.remainingTermYears ?? 0);
  await chooseFirstAvailableOption(page, property.isRental ? ["Yes"] : ["No"], ["let the property"]);
  await chooseFirstAvailableOption(page, property.isRental ? ["Yes"] : ["No"], ["tenancy agreement"]);
  await fillFirstAvailableCurrency(page, ["monthly rental income", "MonthlyRentalIncome"], property.monthlyRent ?? 0);
  await fillFirstAvailableCurrency(page, ["monthly mortgage payments", "MonthlyPayments"], property.monthlyMortgagePayment);
}

async function advance(page: Page): Promise<void> {
  await clickFirstAvailableButton(page, ["Next", "Continue"]);
  await page.waitForTimeout(1000);
}

async function waitForResult(page: Page, context: RunContext): Promise<void> {
  await page.getByText(/^Loading$/i).waitFor({ state: "hidden", timeout: Math.min(context.timeoutMs, 60000) }).catch(() => undefined);
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      const resultText = text.slice(Math.max(text.lastIndexOf("Results"), 0));
      return (
        /there are problems with your submission|error:|required|tell us|choose/i.test(text) ||
        (!/loading/i.test(resultText) && /£\s*[0-9][0-9,]*/i.test(resultText))
      );
    },
    undefined,
    { timeout: Math.min(context.timeoutMs, 60000) }
  ).catch(() => undefined);
}

async function extractResult(page: Page): Promise<{
  maximumBorrowing: number | null;
  monthlyPayment: number | null;
  messages: string[];
}> {
  const text = await page.locator("body").innerText();
  const resultText = text.slice(Math.max(text.lastIndexOf("Results"), 0));
  if (/there are problems with your submission|error:/i.test(text)) {
    return {
      maximumBorrowing: null,
      monthlyPayment: null,
      messages: resultMessages(text)
    };
  }

  return {
    maximumBorrowing: /loading/i.test(resultText) ? null : extractMaximumCurrency(resultText),
    monthlyPayment: null,
    messages: resultMessages(resultText)
  };
}

async function fillDateOfBirth(page: Page, applicant: Applicant): Promise<void> {
  const parts = parseDateParts(applicant.dateOfBirth ?? dateOfBirthFromAge(applicant.age));
  const idPrefix = applicant.index === 1 ? "AffCalc-q140" : "AffCalc-q190";
  await setInputValueById(page, `${idPrefix}-Day`, parts.day) || await setInputValueByPlaceholder(page, "DD", parts.day);
  await setInputValueById(page, `${idPrefix}-Month`, parts.month) || await setInputValueByPlaceholder(page, "MM", parts.month);
  await setInputValueById(page, `${idPrefix}-Year`, parts.year) || await setInputValueByPlaceholder(page, "YYYY", parts.year);
}

async function checkRadioById(page: Page, id: string): Promise<boolean> {
  const radio = page.locator(`#${id}`);
  if (await radio.count() === 0) return false;
  const label = page.locator(`label[for="${cssAttributeValue(id)}"]`);
  if (await label.first().isVisible().catch(() => false)) {
    await label.first().click({ force: true });
  } else if (await radio.first().isVisible().catch(() => false)) {
    await radio.first().check({ force: true });
  } else {
    await radio.first().evaluate((node) => {
      (node as HTMLInputElement).click();
    });
  }
  await radio.first().evaluate((node) => {
    const input = node as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return true;
}

async function checkCheckboxById(page: Page, id: string): Promise<boolean> {
  const checkbox = page.locator(`#${id}`);
  if (await checkbox.count() === 0) return false;
  const label = page.locator(`label[for="${cssAttributeValue(id)}"]`);
  if (await label.first().isVisible().catch(() => false)) {
    await label.first().click({ force: true });
  } else if (await checkbox.first().isVisible().catch(() => false)) {
    await checkbox.first().check({ force: true });
  } else {
    await checkbox.first().evaluate((node) => {
      (node as HTMLInputElement).click();
    });
  }
  await checkbox.first().evaluate((node) => {
    const input = node as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return true;
}

async function setClientValuesById(page: Page, applicant: Applicant): Promise<void> {
  const parts = parseDateParts(applicant.dateOfBirth ?? dateOfBirthFromAge(applicant.age));
  const datePrefix = applicant.index === 1 ? "AffCalc-q140" : "AffCalc-q190";
  const retirementId = applicant.index === 1 ? "AffCalc-q180-RetirementAge" : "AffCalc-q230-RetirementAge";
  await setInputValueById(page, `${datePrefix}-Day`, parts.day) || await setInputValueByPlaceholder(page, "DD", parts.day);
  await setInputValueById(page, `${datePrefix}-Month`, parts.month) || await setInputValueByPlaceholder(page, "MM", parts.month);
  await setInputValueById(page, `${datePrefix}-Year`, parts.year) || await setInputValueByPlaceholder(page, "YYYY", parts.year);
  await setInputValueById(page, retirementId, String(applicant.retirementAge ?? 70)) ||
    await setInputValueAfterText(page, "planned retirement age", String(applicant.retirementAge ?? 70));
}

async function setInputValueById(page: Page, id: string, value: string): Promise<boolean> {
  const field = page.locator(`#${id}`);
  if (await field.count() === 0 || !(await field.first().isVisible().catch(() => false))) return false;
  return setInputValue(field.first(), value);
}

async function setSelectValueById(page: Page, id: string, value: string): Promise<boolean> {
  const field = page.locator(`#${id}`);
  if (await field.count() === 0) return false;
  await field.first().selectOption(value, { force: true }).catch(async () => {
    await field.first().evaluate((node, nextValue) => {
      const select = node as HTMLSelectElement;
      select.value = nextValue;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  });
  await field.first().evaluate((node) => {
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return true;
}

async function setInputValueByPlaceholder(page: Page, placeholder: string, value: string): Promise<boolean> {
  const fields = page.getByPlaceholder(placeholder, { exact: true });
  const count = await fields.count();
  for (let index = 0; index < count; index += 1) {
    const field = fields.nth(index);
    if (await field.isVisible().catch(() => false)) return setInputValue(field, value);
  }

  return false;
}

async function setInputValueAfterText(page: Page, text: string, value: string): Promise<boolean> {
  const field = page.locator(`xpath=.//*[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${text.toLowerCase()}")]/following::input[1]`);
  if (await field.count() === 0 || !(await field.first().isVisible().catch(() => false))) return false;
  return setInputValue(field.first(), value);
}

async function setInputValue(field: ReturnType<Page["locator"]>, value: string): Promise<boolean> {
  const target = field.first();
  await target.click({ force: true });
  await target.fill(value);
  await target.evaluate((node, nextValue) => {
    const input = node as HTMLInputElement;
    input.value = nextValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
  }, value);
  return true;
}

async function fillDependantBands(page: Page, input: LenderReadyInput, applicantIndex: number): Promise<void> {
  const bands = {
    Age0to5: input.household.dependants.filter((dependant) => dependant.age <= 5).length,
    Age6to11: input.household.dependants.filter((dependant) => dependant.age >= 6 && dependant.age <= 11).length,
    Age12to17: input.household.dependants.filter((dependant) => dependant.age >= 12 && dependant.age <= 17).length,
    Age18More: input.household.dependants.filter((dependant) => dependant.age >= 18).length
  };
  const prefix = applicantIndex === 1 ? "AffCalc-q160" : "AffCalc-q210";

  for (const [suffix, count] of Object.entries(bands)) {
    await setInputValueById(page, `${prefix}-${suffix}-${Object.keys(bands).indexOf(suffix)}`, String(count));
  }
}

async function fillTerm(page: Page, labels: string[], years: number): Promise<void> {
  await fillFirstAvailableText(page, labels.flatMap((label) => [`${label} years`, "years", "YY"]), String(Math.max(0, years)));
  await fillFirstAvailableText(page, labels.flatMap((label) => [`${label} months`, "months", "MM"]), "0");
}

function applicationTypeLabels(input: LenderReadyInput): string[] {
  if (input.case.mortgagePurpose === "purchase") return ["Buy a new property"];
  if (input.case.mortgagePurpose === "further_advance") return ["Borrow more"];
  return ["Remortgage existing property"];
}

function repaymentMethodLabels(repaymentType: LenderReadyInput["case"]["repaymentType"]): string[] {
  if (repaymentType === "interest_only") return ["Interest Only", "Interest only"];
  if (repaymentType === "part_and_part") return ["Part and Part", "Part and part"];
  return ["Repayment"];
}

function parseDateParts(value: string): { day: string; month: string; year: string } {
  const parts = value.split(/[-/]/);
  if (parts[0]?.length === 4) {
    return { year: parts[0], month: parts[1] ?? "01", day: parts[2] ?? "01" };
  }
  return { day: parts[0] ?? "01", month: parts[1] ?? "01", year: parts[2] ?? String(new Date().getFullYear() - 35) };
}

function dateOfBirthFromAge(age: number): string {
  return `01/01/${new Date().getFullYear() - age}`;
}

function hasOtherIncome(applicant: Applicant): boolean {
  return applicant.otherIncome.length > 0 || totalAnnualPensionIncome(applicant) > 0;
}

function directorIncome(applicant: Applicant, period: "current" | "previous"): number {
  const profit =
    period === "current"
      ? applicant.employment.netProfitCurrentYear
      : applicant.employment.netProfitPreviousYear;
  return profit ?? applicant.employment.annualGrossIncome ?? 0;
}

function totalAnnualPensionIncome(applicant: Applicant): number {
  return (applicant.employment.annualPensionIncome ?? 0) + (applicant.employment.otherAnnualPensionIncome ?? 0);
}

function otherIncomeTotal(applicant: Applicant, type: string): number {
  return applicant.otherIncome
    .filter((income) => income.type === type)
    .reduce((sum, income) => sum + income.annualAmount / 12, 0);
}

function otherIncomeAnnualTotal(applicant: Applicant, type: string): number {
  return applicant.otherIncome
    .filter((income) => income.type === type)
    .reduce((sum, income) => sum + income.annualAmount, 0);
}

function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
