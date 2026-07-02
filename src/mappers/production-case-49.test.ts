import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import { lenderReadyInputSchema } from "../domain/validation.js";
import { mapBarclaysRawInput } from "./barclays/raw-to-lender-ready.js";
import { mapHsbcRawInput } from "./hsbc/raw-to-lender-ready.js";
import { mapNatWestRawInput } from "./natwest/raw-to-lender-ready.js";
import { mapNationwideRawInput } from "./nationwide/raw-to-lender-ready.js";
import { mapSantanderRawInput } from "./santander/raw-to-lender-ready.js";

const rawCasePath = "samples/test-cases/additional-raw-case-49-production-joint-employed-full-income-outgoings.yaml";

async function loadRawCase(): Promise<Record<string, unknown>> {
  const rawText = await readFile(rawCasePath, "utf8");
  return parseYaml(rawText) as Record<string, unknown>;
}

test("HSBC mapper normalizes DOB and avoids double-counting variable income", async () => {
  const raw = await loadRawCase();
  const mapped = lenderReadyInputSchema.parse(mapHsbcRawInput(raw).input);

  assert.equal(mapped.case.termYears, 25);
  assert.equal(mapped.applicants[0].dateOfBirth, "1987-01-01");
  assert.equal(mapped.applicants[1].dateOfBirth, "1989-01-01");

  assert.equal(mapped.applicants[0].employment.annualBonus, 43960);
  assert.equal(mapped.applicants[0].employment.annualOvertime, 0);
  assert.equal(mapped.applicants[0].employment.annualCommission, 0);
  assert.equal(mapped.applicants[1].employment.annualBonus, 24780);
  assert.equal(mapped.applicants[1].employment.annualOvertime, 0);
  assert.equal(mapped.applicants[1].employment.annualCommission, 0);

  const applicantOneIncomeTypes = mapped.applicants[0].otherIncome.map((income) => income.type);
  assert.equal(applicantOneIncomeTypes.includes("additional_duty_hours"), false);
  assert.equal(applicantOneIncomeTypes.includes("nursing_bank"), false);
  assert.equal(applicantOneIncomeTypes.includes("rental_income_btl"), false);
});

test("Barclays mapper normalizes DOB and uses standard annualisation for benefits", async () => {
  const raw = await loadRawCase();
  const mapped = lenderReadyInputSchema.parse(mapBarclaysRawInput(raw).input);

  assert.equal(mapped.applicants[0].dateOfBirth, "1987-01-01");
  assert.equal(mapped.applicants[1].dateOfBirth, "1989-01-01");

  const applicantOneIncome = Object.fromEntries(mapped.applicants[0].otherIncome.map((income) => [income.type, income.annualAmount]));
  const applicantTwoIncome = Object.fromEntries(mapped.applicants[1].otherIncome.map((income) => [income.type, income.annualAmount]));
  assert.equal(applicantOneIncome.employment_support_allowance, 4680);
  assert.equal(applicantOneIncome.disability_living_allowance, 3250);
  assert.equal(applicantTwoIncome.personal_independence_payment, 4940);
  assert.equal(applicantTwoIncome.income_support, 1430);
});

test("Santander mapper separates employment and benefit annualisation", async () => {
  const raw = await loadRawCase();
  const mapped = lenderReadyInputSchema.parse(mapSantanderRawInput(raw).input);

  assert.equal(mapped.applicants[0].dateOfBirth, "1987-01-01");
  assert.equal(mapped.applicants[1].dateOfBirth, "1989-01-01");
  assert.equal(mapped.applicants[0].studentLoanBalance, 26000);
  assert.equal(mapped.applicants[0].monthlyStudentLoanPayment, 225);
  assert.equal(mapped.applicants[1].studentLoanBalance, 0);
  assert.equal(mapped.applicants[1].monthlyStudentLoanPayment, 0);

  assert.equal(mapped.applicants[0].employment.annualOvertime, 8050);
  assert.equal(mapped.applicants[0].employment.annualCommission, 21850);
  assert.equal(mapped.applicants[1].employment.annualBonus, 12000);

  const applicantOneIncome = Object.fromEntries(mapped.applicants[0].otherIncome.map((income) => [income.type, income.annualAmount]));
  const applicantTwoIncome = Object.fromEntries(mapped.applicants[1].otherIncome.map((income) => [income.type, income.annualAmount]));
  assert.equal(applicantOneIncome.employment_support_allowance, 4680);
  assert.equal(applicantTwoIncome.personal_independence_payment, 4940);
  assert.equal(applicantTwoIncome.town_area_or_car_allowance, 6500);
});

test("Nationwide mapper preserves workbook-specific outgoing buckets", async () => {
  const raw = await loadRawCase();
  const mapped = lenderReadyInputSchema.parse(mapNationwideRawInput(raw).input);

  assert.equal(mapped.outgoings.creditCardBalances, 10900);
  assert.equal(mapped.outgoings.overdraftBalances, 1950);
  assert.equal(mapped.outgoings.monthlyLoanRepayments, 2250);
  assert.equal(mapped.outgoings.monthlyPersonalLoanOrHirePurchase, 1410);
  assert.equal(mapped.outgoings.monthlySecuredLoanPayments, 520);
  assert.equal(mapped.outgoings.monthlyBuyNowPayLater, 95);
  assert.equal(mapped.outgoings.monthlyStudentLoanPayments, 225);
  assert.equal(mapped.outgoings.otherMonthlyOutgoings, 465);
  assert.equal(mapped.outgoings.monthlyChildcareAndEducation, 1100);
  assert.equal(mapped.outgoings.monthlySchoolFees, 460);
  assert.equal(mapped.outgoings.monthlyMaintenancePayments, 375);
  assert.equal(mapped.outgoings.monthlyCouncilTax, 265);
  assert.equal(mapped.outgoings.monthlyBuildingInsurance, 42);
});

test("NatWest mapper follows workbook buckets for income and outgoings", async () => {
  const raw = await loadRawCase();
  const mapped = lenderReadyInputSchema.parse(mapNatWestRawInput(raw).input);

  assert.equal(mapped.loan.propertyValue, 685000);
  assert.equal(mapped.loan.loanAmount, 540000);
  assert.equal(mapped.case.termYears, 30);
  assert.equal(mapped.household.dependants.length, 3);

  assert.equal(mapped.applicants[0].monthlyPensionContribution, 850);
  assert.equal(mapped.applicants[1].monthlyPensionContribution, 620);
  assert.equal(mapped.applicants[0].employment.annualGrossIncome, 181760);
  assert.equal(mapped.applicants[1].employment.annualGrossIncome, 127770);
  assert.equal(mapped.applicants[0].employment.annualBonus, 19000);
  assert.equal(mapped.applicants[1].employment.annualBonus, 15000);

  const applicantOneIncomeTypes = mapped.applicants[0].otherIncome.map((income) => income.type);
  const applicantTwoIncomeTypes = mapped.applicants[1].otherIncome.map((income) => income.type);
  assert.equal(applicantOneIncomeTypes.includes("child_benefit"), false);
  assert.equal(applicantTwoIncomeTypes.includes("child_benefit"), false);
  assert.equal(applicantOneIncomeTypes.includes("maintenance"), false);
  assert.equal(applicantOneIncomeTypes.includes("personal_independence_payment"), false);
  assert.equal(applicantOneIncomeTypes.includes("disability_living_allowance"), false);
  assert.equal(applicantOneIncomeTypes.includes("carers_allowance"), false);
  assert.equal(applicantOneIncomeTypes.includes("income_support"), false);

  assert.equal(mapped.outgoings.monthlyLoanRepayments, 1670);
  assert.equal(mapped.outgoings.monthlyPersonalLoanOrHirePurchase, 1000);
  assert.equal(mapped.outgoings.otherMonthlyOutgoings, 2400);
  assert.equal(mapped.outgoings.creditCardBalances + mapped.outgoings.overdraftBalances, 12850);
  assert.equal(mapped.otherProperties.reduce((sum, property) => sum + property.monthlyMortgagePayment, 0), 910);
});
