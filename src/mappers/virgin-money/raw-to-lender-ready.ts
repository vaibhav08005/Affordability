import type {
  Applicant,
  EmploymentType,
  HalifaxOtherIncomeType,
  LenderReadyInput,
  MortgagePurpose,
  RepaymentType,
  SelfEmploymentType,
  Tenure
} from "../../domain/contracts.js";

type RawRecord = Record<string, unknown>;

interface MappingIssue {
  field: string;
  message: string;
}

export interface VirginMoneyRawMappingResult {
  input: LenderReadyInput;
  issues: MappingIssue[];
}

const SCOTLAND_POSTCODE_PREFIXES = [
  "AB",
  "DD",
  "DG",
  "EH",
  "FK",
  "HS",
  "IV",
  "KA",
  "KW",
  "KY",
  "ML",
  "PA",
  "PH",
  "TD",
  "ZE"
];

export function mapVirginMoneyRawInput(raw: RawRecord): VirginMoneyRawMappingResult {
  const issues: MappingIssue[] = [];
  const numberOfApplicants = rawNumber(raw.var_no_of_applicants, 1) >= 2 ? 2 : 1;
  const journey = rawString(raw.var_journey) || rawString(raw.var_mortgage_type) || "unknown";
  const mortgagePurpose = mapMortgagePurpose(raw);
  const repaymentType = mapRepaymentType(raw.var_new_repayment_type ?? raw.var_repayment_type);
  const propertyValue = mapPropertyValue(raw, mortgagePurpose);
  const deposit = rawNumber(raw.var_deposit, sumDepositSources(raw));
  const loanAmount = mapLoanAmount(raw, mortgagePurpose, propertyValue, deposit);
  const applicants = buildApplicants(raw, numberOfApplicants, issues);
  const postcode = propertyPostcode(raw);
  const isInScotland = isScottishPostcode(postcode);
  const sharedOwnershipOrEquity = mapSharedOwnershipFlag(raw);
  const sharedOwnershipScheme = sharedOwnershipOrEquity ? mapSharedOwnershipScheme(raw) : undefined;
  const otherProperties = mapOtherProperties(raw);
  const otherMortgageCommitments = mapResidentialMortgageCommitments(raw);

  const input: LenderReadyInput = {
    lender: "virgin_money",
    case: {
      journey,
      applicationType: numberOfApplicants === 1 ? "single" : "joint",
      numberOfApplicants,
      mortgagePurpose,
      customerType: mapCustomerType(raw),
      repaymentType,
      termYears: monthsToYears(rawNumber(raw.var_new_mortgage_term ?? raw.var_mortgage_term, 300)),
      sharedOwnershipOrEquity,
      sharedOwnershipScheme,
      monthlySharedOwnershipRent: sharedOwnershipScheme === "shared_ownership" ? rawNumber(raw.var_rent_income, 0) : undefined,
      sharedEquityCustomerStakePercent: sharedOwnershipScheme === "shared_equity" ? mapSharedEquityCustomerStakePercent(raw, propertyValue) : undefined,
      monthlySharedEquityInterestPayment: sharedOwnershipScheme === "shared_equity" ? 0 : undefined,
      equityLoanBalance: sharedOwnershipScheme === "shared_equity"
        ? rawNumber(raw.var_htb_loan_amount ?? raw.var_shared_equity_loan_amount, 0)
        : undefined,
      equityLoanInterestRatePercent: sharedOwnershipScheme === "shared_equity" ? 0 : undefined,
      hasInterestOnly: repaymentType === "interest_only" || repaymentType === "part_and_part",
      interestOnlyLoanAmount: mapInterestOnlyLoanAmount(raw, repaymentType, loanAmount),
      monthlyRepaymentPlanPremium: mapMonthlyRepaymentPlanPremium(raw, applicants)
    },
    property: {
      isInScotland,
      tenure: mapTenure(raw, isInScotland),
      epcRating: "unknown"
    },
    loan: {
      propertyValue,
      loanAmount,
      currentBalance: optionalMoney(raw.var_remo_remaining_balance),
      monthlyRepayment: optionalMoney(raw.var_mthly_repay_amount),
      currentLender: optionalString(raw.var_current_lender)
    },
    household: {
      dependants: mapDependants(raw, numberOfApplicants)
    },
    applicants,
    outgoings: {
      monthlyLoanRepayments: mapMonthlyLoanRepayments(raw),
      creditCardBalances: mapCreditCardBalances(raw),
      overdraftBalances: mapOverdraftBalances(raw),
      otherMonthlyOutgoings: mapOtherMonthlyOutgoings(raw),
      monthlyBuyToLetPayments: otherProperties.reduce((sum, property) => sum + property.monthlyMortgagePayment, 0),
      otherMortgageCommitments
    },
    otherProperties
  };

  if (!postcode) {
    issues.push({
      field: "property.postcode",
      message: "Property address postcode was not present; Virgin Money country of residence defaults to England through the adapter."
    });
  }

  if (sharedOwnershipScheme === "shared_equity") {
    issues.push({
      field: "case.sharedOwnershipScheme",
      message: "Virgin Money workbook distinguishes shared ownership from shared equity, but the current adapter only has a shared-ownership purchase toggle."
    });
  }

  if (input.household.dependants.length > 9) {
    issues.push({
      field: "household.dependants",
      message: "Virgin Money workbook says cases with more than 9 financial dependants should not run; the adapter caps the submitted value at 9."
    });
  }

  if (input.case.termYears > 40) {
    issues.push({
      field: "case.termYears",
      message: "Mortgage term exceeded the shared contract maximum and will fail validation unless the raw term is reduced."
    });
  }

  return { input, issues };
}

function mapMortgagePurpose(raw: RawRecord): MortgagePurpose {
  const journey = normalized(raw.var_journey);
  const mortgageType = normalized(raw.var_mortgage_type);
  if (["ftb", "first_time_buyer", "hm", "home_mover", "moving_home", "purchase"].includes(journey) || mortgageType === "moving_home") {
    return "purchase";
  }
  if (["further_advance", "fa"].includes(journey) || mortgageType === "further_advance") {
    return "further_advance";
  }
  const additionalBorrowing = rawNumber(raw.var_equity_release_amount ?? raw.var_additional_borrowing ?? raw.var_add_borrow_amount, 0);
  return additionalBorrowing > 0 || hasValue(raw.var_add_borrow_details)
    ? "remortgage_capital_raising"
    : "remortgage_no_additional_borrowing";
}

function mapCustomerType(raw: RawRecord): "first_time_buyer" | "home_mover" {
  const journey = normalized(raw.var_journey);
  const ownershipType = normalized(raw.var_ownership_type_ftb);
  if (journey === "ftb" || ownershipType.includes("first_time")) return "first_time_buyer";
  return "home_mover";
}

function mapRepaymentType(value: unknown): RepaymentType {
  const repayment = normalized(value);
  if (repayment.includes("interest_only") || repayment === "io") return "interest_only";
  if (repayment.includes("part")) return "part_and_part";
  return "capital_and_interest";
}

function mapPropertyValue(raw: RawRecord, mortgagePurpose: MortgagePurpose): number {
  const ownershipType = normalized(raw.var_ownership_type || raw.var_ownership_type_ftb);
  const valueOfShare = rawNumber(raw.var_value_of_share, 0);
  if (ownershipType.includes("shared_ownership") && valueOfShare > 0) return valueOfShare;
  if (mortgagePurpose === "purchase") return rawNumber(raw.var_property_value, 0);
  return rawNumber(raw.var_value_of_share, rawNumber(raw.var_property_value, 0));
}

function mapLoanAmount(raw: RawRecord, mortgagePurpose: MortgagePurpose, propertyValue: number, deposit: number): number {
  const ownershipType = normalized(raw.var_ownership_type || raw.var_ownership_type_ftb);
  const payDownAmount = rawNumber(raw.var_pay_down_amount, 0);
  const additionalBorrowing = rawNumber(raw.var_equity_release_amount ?? raw.var_additional_borrowing ?? raw.var_add_borrow_amount, 0);

  if (mortgagePurpose === "purchase") {
    const schemeLoan = ownershipType.includes("shared") || ownershipType.includes("htb") || ownershipType.includes("help_to_buy")
      ? rawNumber(raw.var_htb_loan_amount ?? raw.var_shared_equity_loan_amount, 0)
      : 0;
    return nonNegative(propertyValue - deposit - schemeLoan);
  }

  if (mortgagePurpose === "further_advance") return nonNegative(additionalBorrowing);

  const currentBalance = rawNumber(raw.var_remo_remaining_balance, 0);
  return nonNegative(currentBalance - payDownAmount + additionalBorrowing);
}

function mapSharedOwnershipFlag(raw: RawRecord): boolean {
  const ownershipType = normalized(raw.var_ownership_type || raw.var_ownership_type_ftb);
  if (!ownershipType || ownershipType === "standard") return false;
  return ["shared", "equity", "htb", "help_to_buy", "forces"].some((token) => ownershipType.includes(token));
}

function mapSharedOwnershipScheme(raw: RawRecord): "shared_ownership" | "shared_equity" {
  const ownershipType = normalized(raw.var_ownership_type || raw.var_ownership_type_ftb);
  if (ownershipType.includes("shared_ownership")) return "shared_ownership";
  return "shared_equity";
}

function mapSharedEquityCustomerStakePercent(raw: RawRecord, propertyValue: number): number {
  const explicitShareValue = rawNumber(raw.var_value_of_share, 0);
  if (propertyValue > 0 && explicitShareValue > 0) return roundPercent((explicitShareValue / propertyValue) * 100);
  const equityLoan = rawNumber(raw.var_htb_loan_amount ?? raw.var_shared_equity_loan_amount, 0);
  if (propertyValue > 0 && equityLoan > 0) return roundPercent(((propertyValue - equityLoan) / propertyValue) * 100);
  return 100;
}

function mapInterestOnlyLoanAmount(raw: RawRecord, repaymentType: RepaymentType, loanAmount: number): number | undefined {
  if (repaymentType === "capital_and_interest") return undefined;
  if (repaymentType === "interest_only") return loanAmount;
  return rawNumber(raw.var_new_interest_only_amount ?? raw.var_interest_only_amount, 0);
}

function mapMonthlyRepaymentPlanPremium(raw: RawRecord, applicants: Applicant[]): number | undefined {
  const repaymentType = mapRepaymentType(raw.var_new_repayment_type ?? raw.var_repayment_type);
  if (repaymentType === "capital_and_interest") return undefined;
  const explicit = optionalMoney(raw.var_repay_vehicle_mthly_contribution);
  if (explicit != null) return explicit;
  return applicants.reduce((sum, applicant) => {
    const prefix = `var_appl${applicant.index}`;
    return sum + rawNumber(raw[`${prefix}_outgoings_pension_contribution`], 0) + rawNumber(raw[`${prefix}_outgoings_investments`], 0);
  }, 0);
}

function mapTenure(raw: RawRecord, isInScotland: boolean): Tenure {
  const tenure = normalized(raw.var_property_details_tenure);
  if (tenure.includes("lease") || tenure.includes("commonhold")) return "leasehold";
  if (isInScotland) return "outright_or_absolute_ownership";
  return "freehold";
}

function buildApplicants(raw: RawRecord, numberOfApplicants: 1 | 2, issues: MappingIssue[]): Applicant[] {
  const applicants: Applicant[] = [];
  for (let index = 1; index <= numberOfApplicants; index += 1) {
    applicants.push(buildApplicant(raw, index as 1 | 2, issues));
  }
  return applicants;
}

function buildApplicant(raw: RawRecord, index: 1 | 2, issues: MappingIssue[]): Applicant {
  const prefix = `var_appl${index}`;
  const dateOfBirth = optionalString(raw[`${prefix}_date_of_birth`]);
  if (!dateOfBirth) {
    issues.push({
      field: `${prefix}_date_of_birth`,
      message: "Date of birth missing; applicant age defaulted to 35 for calculator eligibility."
    });
  }
  return {
    index,
    dateOfBirth,
    age: dateOfBirth ? ageFromEpoch(dateOfBirth) : 35,
    retirementAge: rawNumber(raw[`${prefix}_retirement_age`], 70),
    employment: mapEmployment(raw, index, issues),
    otherIncome: mapOtherIncome(raw, index)
  };
}

function mapEmployment(raw: RawRecord, index: 1 | 2, issues: MappingIssue[]): Applicant["employment"] {
  const prefix = `var_appl${index}`;
  const employmentType = normalized(raw[`${prefix}_employment_details_employment_type`]);
  const employedType = normalized(raw[`${prefix}_employment_details_employed_type`]);
  const contractType = normalized(raw[`${prefix}_employment_details_contract_type`]);
  const businessType = mapBusinessType(raw[`${prefix}_business_setup_type`]);
  const ownershipPercentage = rawNumber(raw[`${prefix}_employed_company_details_ownership_percentage`], 0);
  const tenPercentShare = yes(raw[`${prefix}_employment_details_is_ten_percent`]);
  const isContractor = employmentType.includes("contractor") || contractType.includes("contract") || employedType.includes("contract");
  const type: EmploymentType = inferEmploymentType(employmentType, businessType, ownershipPercentage, tenPercentShare, isContractor);
  const businessStartDate = raw[`${prefix}_business_start_date`];
  const selfEmployedMonths = monthsSinceEpoch(businessStartDate);
  const hasSufficientSelfEmploymentHistory = type !== "self_employed" || selfEmployedMonths == null || selfEmployedMonths >= 24;

  if (!hasSufficientSelfEmploymentHistory) {
    issues.push({
      field: `${prefix}_business_start_date`,
      message: "Virgin Money workbook says self-employed income should be set to 0 where trading is under 24 months."
    });
  }

  const employment: Applicant["employment"] = {
    type,
    isContractor,
    annualGrossIncome: mapAnnualGrossIncome(raw, prefix, isContractor),
    annualOvertime: annualize(raw[`${prefix}_recent_overtime`], raw[`${prefix}_recent_overtime_frequency`]),
    annualBonus: mapVariableIncomeLowerOfRecentAndAverage(raw, prefix, "recent_nongtd_bonus", "prev_nongtd_bonus"),
    annualCommission: annualize(raw[`${prefix}_recent_commission`], raw[`${prefix}_recent_commission_frequency`]),
    annualPensionIncome: rawNumber(raw[`${prefix}_mthly_pension`], 0) * 12,
    otherAnnualPensionIncome: 0
  };

  if (type === "self_employed") {
    employment.businessType = businessType ?? "sole_trader";
    const profits = hasSufficientSelfEmploymentHistory ? mapSelfEmployedProfits(raw, prefix, employment.businessType) : { current: 0, previous: 0 };
    employment.netProfitCurrentYear = profits.current;
    employment.netProfitPreviousYear = profits.previous;
    if (employment.businessType === "limited_company") {
      const salaries = twoYearLowerOrAverage(rawNumber(raw[`${prefix}_business_salary`] ?? raw[`${prefix}_dir_partnr_curr_yr_salary`], 0), rawNumber(raw[`${prefix}_dir_partnr_curr_yr_salary`] ?? raw[`${prefix}_business_salary`], 0));
      employment.annualGrossIncome = hasSufficientSelfEmploymentHistory ? salaries : 0;
    }
  }

  return employment;
}

function inferEmploymentType(
  employmentType: string,
  businessType: SelfEmploymentType | undefined,
  ownershipPercentage: number,
  tenPercentShare: boolean,
  isContractor: boolean
): EmploymentType {
  if (["retired", "pension"].some((token) => employmentType.includes(token))) return "pension";
  if (["not_working", "unemployed", "student", "homemaker", "home_maker"].some((token) => employmentType.includes(token))) return "other";
  if (isContractor) return "other";
  if (businessType || ownershipPercentage >= 20 || tenPercentShare || employmentType.includes("self") || employmentType.includes("partner")) {
    return "self_employed";
  }
  return "employed";
}

function mapAnnualGrossIncome(raw: RawRecord, prefix: string, isContractor: boolean): number {
  const salary = rawNumber(raw[`${prefix}_gross_annual_salary`], 0);
  const regularAllowance = annualize(raw[`${prefix}_recent_regular_allowance`], raw[`${prefix}_recent_regular_allowance_frequency`]);
  const otherAllowance = annualize(raw[`${prefix}_recent_other_allowance`], raw[`${prefix}_recent_other_allowance_frequency`]);

  if (isContractor) {
    const contractRate = rawNumber(raw[`${prefix}_contract_details_rate_amount`], 0);
    const rateFrequency = normalized(raw[`${prefix}_contract_details_rate_frequency`]);
    if (contractRate > 0) {
      if (rateFrequency.includes("hour")) return contractRate * 8 * 5 * 46;
      if (rateFrequency.includes("week")) return contractRate * 46;
      return contractRate * 5 * 46;
    }
    const contractSalary = rawNumber(raw[`${prefix}_contract_salary`], 0);
    if (contractSalary > 0) return contractSalary + regularAllowance + otherAllowance + contractorVariableIncome(raw, prefix);
    const currentDividends = rawNumber(raw[`${prefix}_business_curr_yr_dividends`], 0);
    const currentShareProfit = rawNumber(raw[`${prefix}_business_curr_yr_share_profit`], 0);
    if (salary > 0 || currentDividends > 0 || currentShareProfit > 0) return salary + Math.max(currentDividends, currentShareProfit);
  }

  return salary + regularAllowance + otherAllowance;
}

function mapSelfEmployedProfits(raw: RawRecord, prefix: string, businessType: SelfEmploymentType): { current: number; previous: number } {
  const currentSalary = rawNumber(raw[`${prefix}_business_salary`] ?? raw[`${prefix}_dir_partnr_curr_yr_salary`], 0);
  const previousSalary = rawNumber(raw[`${prefix}_dir_partnr_curr_yr_salary`] ?? raw[`${prefix}_business_salary`], 0);
  if (businessType === "limited_company") {
    const currentDividends = rawNumber(raw[`${prefix}_business_curr_yr_dividends`], 0);
    const previousDividends = rawNumber(raw[`${prefix}_business_prev_yr_dividends`] ?? raw[`${prefix}_business_curr_yr_dividends`], 0);
    const currentProfit = rawNumber(raw[`${prefix}_business_curr_yr_share_profit`] ?? raw[`${prefix}_business_curr_yr_net_profit`], 0);
    const previousProfit = rawNumber(raw[`${prefix}_business_prev_yr_share_profit`] ?? raw[`${prefix}_business_prev_yr_net_profit`], 0);
    const current = currentSalary + Math.max(currentDividends, currentProfit);
    const previous = previousSalary + Math.max(previousDividends, previousProfit);
    if (current < 0 || previous < 0) return { current: 0, previous: 0 };
    return {
      current,
      previous
    };
  }

  const currentProfit = rawNumber(
    raw[`${prefix}_st_curr_yr_profit`] ?? raw[`${prefix}_business_curr_yr_share_profit`] ?? raw[`${prefix}_business_curr_yr_net_profit`],
    0
  );
  const previousProfit = rawNumber(
    raw[`${prefix}_st_prev_yr_profit`] ?? raw[`${prefix}_business_prev_yr_share_profit`] ?? raw[`${prefix}_business_prev_yr_net_profit`],
    0
  );
  const addSalary = businessType === "llp";
  const current = (addSalary ? currentSalary : 0) + currentProfit;
  const previous = (addSalary ? previousSalary : 0) + previousProfit;
  if (current < 0 || previous < 0) return { current: 0, previous: 0 };
  return {
    current,
    previous
  };
}

function contractorVariableIncome(raw: RawRecord, prefix: string): number {
  return mapVariableIncomeLowerOfRecentAndAverage(raw, prefix, "recent_nongtd_bonus", "prev_nongtd_bonus") +
    annualize(raw[`${prefix}_recent_overtime`], raw[`${prefix}_recent_overtime_frequency`]) +
    annualize(raw[`${prefix}_recent_commission`], raw[`${prefix}_recent_commission_frequency`]);
}

function mapVariableIncomeLowerOfRecentAndAverage(raw: RawRecord, prefix: string, recentSuffix: string, previousSuffix: string): number {
  const recent = annualize(raw[`${prefix}_${recentSuffix}`], raw[`${prefix}_${recentSuffix}_frequency`]);
  const previous = annualize(raw[`${prefix}_${previousSuffix}`], raw[`${prefix}_${previousSuffix}_frequency`]);
  if (recent === 0 && previous === 0) return 0;
  return twoYearLowerOrAverage(recent, previous);
}

function twoYearLowerOrAverage(current: number, previous: number): number {
  if (current === 0 && previous === 0) return 0;
  if (previous <= 0) return Math.round(current);
  return Math.round(current < previous ? current : (current + previous) / 2);
}

function mapOtherIncome(raw: RawRecord, index: 1 | 2): Applicant["otherIncome"] {
  const prefix = `var_appl${index}`;
  const entries: Applicant["otherIncome"] = [];

  addIncome(entries, "town_area_or_car_allowance", annualize(raw[`${prefix}_recent_regular_allowance`], raw[`${prefix}_recent_regular_allowance_frequency`]));
  addIncome(entries, "shift_allowance", annualize(raw[`${prefix}_recent_other_allowance`], raw[`${prefix}_recent_other_allowance_frequency`]));
  addIncome(entries, "nursing_bank", annualize(raw[`${prefix}_recent_nursing_bank`], raw[`${prefix}_recent_nursing_bank_frequency`]));
  addIncome(entries, "additional_duty_hours", annualize(raw[`${prefix}_recent_additional_hours`], raw[`${prefix}_recent_additional_hours_frequency`]));
  addIncome(entries, "rental_income_btl", rawNumber(raw[`${prefix}_land_curr_profit`], 0) * 12);
  addIncome(entries, "child_benefit", annualize(raw[`${prefix}_child_benefits_amt`], raw[`${prefix}_child_benefits_frequency`]));
  addIncome(entries, "child_tax_credit", annualize(raw[`${prefix}_child_tax_credits`], raw[`${prefix}_child_tax_credits_frequency`]));
  addIncome(entries, "employment_support_allowance", annualize(raw[`${prefix}_employment_and_support_allowance`], raw[`${prefix}_employment_and_support_allowance_frequency`]));
  addIncome(entries, "personal_independence_payment", annualize(raw[`${prefix}_personal_independence_payment`], raw[`${prefix}_personal_independence_payment_frequency`]));
  addIncome(entries, "disability_living_allowance", annualize(raw[`${prefix}_disability_living_allowance`], raw[`${prefix}_disability_living_allowance_frequency`]));
  addIncome(entries, "carers_allowance", annualize(raw[`${prefix}_carers_allowance`], raw[`${prefix}_carers_allowance_frequency`]));
  addIncome(entries, "income_support", annualize(raw[`${prefix}_income_support`], raw[`${prefix}_income_support_frequency`]));
  addIncome(entries, "universal_credit", annualize(raw[`${prefix}_other_state_benefits`], raw[`${prefix}_other_state_benefits_frequency`]));
  addIncome(entries, "maintenance", rawNumber(raw[`${prefix}_mthly_maint_amt`], 0) * 12);

  return mergeIncome(entries);
}

function addIncome(entries: Applicant["otherIncome"], type: HalifaxOtherIncomeType, annualAmount: number): void {
  if (annualAmount > 0) entries.push({ type, annualAmount: Math.round(annualAmount) });
}

function mergeIncome(entries: Applicant["otherIncome"]): Applicant["otherIncome"] {
  const totals = new Map<HalifaxOtherIncomeType, number>();
  for (const entry of entries) totals.set(entry.type, (totals.get(entry.type) ?? 0) + entry.annualAmount);
  return [...totals.entries()].map(([type, annualAmount]) => ({ type, annualAmount }));
}

function mapDependants(raw: RawRecord, numberOfApplicants: 1 | 2): LenderReadyInput["household"]["dependants"] {
  const dependants = [...rawArray(raw.var_appl1_dependents_details), ...rawArray(raw.var_appl2_dependents_details)].map((item) => {
    const dependant = item as RawRecord;
    return {
      age: rawNumber(dependant.age, 0),
      relationship: optionalString(dependant.relationship)
    };
  });
  if (numberOfApplicants === 1) return dependants;
  const applicantRelationship = normalized(raw.var_appl1_joint_rel_status);
  if (["spouse", "civil_partner"].includes(applicantRelationship)) {
    return dependants.filter((dependant) => !["spouse", "civil_partner"].includes(normalized(dependant.relationship)));
  }
  if (applicantRelationship.includes("live") || applicantRelationship.includes("partner")) {
    return dependants.filter((dependant) => normalized(dependant.relationship) !== "partner");
  }
  return dependants;
}

function mapMonthlyLoanRepayments(raw: RawRecord): number {
  return sumCreditCommitments(raw, ["loans", "loan", "student_loans", "student_loan", "secured_loans", "hire_purchase", "lease", "buy_now_pay_later"]) +
    sumApplicantNumbers(raw, "outgoings_other_committed_exp") +
    mapBuyToLetShortfall(raw);
}

function mapCreditCardBalances(raw: RawRecord): number {
  return sumCreditCommitments(raw, ["cards", "card", "credit_card", "store_card"]);
}

function mapOverdraftBalances(raw: RawRecord): number {
  return sumCreditCommitments(raw, ["overdraft", "overdrafts"]);
}

function mapOtherMonthlyOutgoings(raw: RawRecord): number {
  return rawNumber(raw.var_property_details_mthly_council_tax, 0) +
    rawNumber(raw.var_property_details_mthly_bldg_ins, 0) +
    rawNumber(raw.var_property_details_mthly_grnd_rent, 0) +
    rawNumber(raw.var_property_details_mthly_serv_charges, 0) +
    sumApplicantNumbers(raw, "outgoings_utilities") +
    sumApplicantNumbers(raw, "outgoings_phone_internet") +
    sumApplicantNumbers(raw, "outgoings_food_clothing") +
    sumApplicantNumbers(raw, "outgoings_pension_contribution") +
    sumApplicantNumbers(raw, "outgoings_investments") +
    sumApplicantNumbers(raw, "outgoings_transport_travel") +
    sumApplicantNumbers(raw, "outgoings_childcare_cost") +
    sumApplicantNumbers(raw, "outgoings_nursery_school_fee") +
    sumApplicantNumbers(raw, "outgoings_maintenance_payment");
}

function mapBuyToLetShortfall(raw: RawRecord): number {
  return rawArray(raw.var_other_properties).reduce<number>((sum, item) => {
    const property = item as RawRecord;
    if (!isBuyToLetProperty(property)) return sum;
    const rent = rawNumber(property.monthly_rent, 0);
    const mortgage = rawNumber(property.monthly_repayment, 0);
    const propertyCosts = rawNumber(property.monthly_council_tax, 0) + rawNumber(property.monthly_building_insurance, 0);
    const shortfall = rent - mortgage - propertyCosts;
    return shortfall < 0 ? sum + Math.abs(shortfall) : sum;
  }, 0);
}

function mapOtherProperties(raw: RawRecord): LenderReadyInput["otherProperties"] {
  return rawArray(raw.var_other_properties)
    .map((item) => item as RawRecord)
    .filter((property) => yes(property.mortgage_status))
    .filter((property) => isBuyToLetProperty(property))
    .map((property) => ({
      isRental: true,
      propertyValue: rawNumber(property.property_value, 0),
      monthlyMortgagePayment: rawNumber(property.monthly_repayment, 0),
      monthlyRent: optionalMoney(property.monthly_rent),
      currentBalance: optionalMoney(property.current_balance),
      interestOnlyBalance: optionalMoney(property.io_balance),
      remainingTermYears: rawNumber(property.remaining_term, 0) > 0 ? monthsToYears(rawNumber(property.remaining_term, 0)) : undefined,
      repaymentType: mapRepaymentType(property.repayment_type)
    }));
}

function mapResidentialMortgageCommitments(raw: RawRecord): LenderReadyInput["outgoings"]["otherMortgageCommitments"] {
  return rawArray(raw.var_other_properties)
    .map((item) => item as RawRecord)
    .filter((property) => yes(property.mortgage_status))
    .filter((property) => !isBuyToLetProperty(property))
    .map((property) => ({
      outstandingBalance: rawNumber(property.current_balance, 0),
      remainingTermYears: Math.max(1, monthsToYears(rawNumber(property.remaining_term, 12)))
    }))
    .filter((commitment) => commitment.outstandingBalance > 0);
}

function isBuyToLetProperty(property: RawRecord): boolean {
  const occupancyStatus = normalized(property.occupancy_status);
  return yes(property.is_rental_property) || ["let", "to_be_let", "rental_property_already_let"].includes(occupancyStatus);
}

function sumCreditCommitments(raw: RawRecord, types: string[]): number {
  let total = 0;
  for (const index of [1, 2]) {
    for (const item of rawArray(raw[`var_appl${index}_credit_commitments`])) {
      const commitment = item as RawRecord;
      if (!yes(commitment.include_afford)) continue;
      if (!types.includes(normalized(commitment.type))) continue;
      if (types.some((type) => type.includes("card") || type.includes("overdraft"))) {
        total += rawNumber(commitment.current_balance, 0);
      } else {
        total += rawNumber(commitment.monthly_payment, 0);
      }
    }
  }
  return total;
}

function sumApplicantNumbers(raw: RawRecord, suffix: string): number {
  return rawNumber(raw[`var_appl1_${suffix}`], 0) + rawNumber(raw[`var_appl2_${suffix}`], 0);
}

function sumDepositSources(raw: RawRecord): number {
  return rawArray(raw.var_deposit_source_details).reduce<number>((sum, item) => sum + rawNumber((item as RawRecord).amount, 0), 0);
}

function propertyPostcode(raw: RawRecord): string {
  const propertyAddress = raw.var_property_details_address as RawRecord | undefined;
  return propertyAddress && typeof propertyAddress === "object" ? rawString(propertyAddress.postcode) : "";
}

function isScottishPostcode(postcode: string): boolean {
  const compact = postcode.replace(/\s+/g, "").toUpperCase();
  if (!compact) return false;
  if (compact.startsWith("G")) return true;
  return SCOTLAND_POSTCODE_PREFIXES.some((prefix) => compact.startsWith(prefix));
}

function mapBusinessType(value: unknown): SelfEmploymentType | undefined {
  const businessType = normalized(value);
  if (businessType.includes("limited") || businessType.includes("director")) return "limited_company";
  if (businessType.includes("llp")) return "llp";
  if (businessType.includes("partnership") || businessType.includes("partner")) return "partnership";
  if (businessType.includes("sole")) return "sole_trader";
  return undefined;
}

function annualize(amount: unknown, frequency: unknown): number {
  const value = rawNumber(amount, 0);
  if (value === 0) return 0;
  switch (normalized(frequency)) {
    case "hourly":
      return value * 8 * 5 * 52;
    case "daily":
      return value * 5 * 52;
    case "weekly":
      return value * 52;
    case "fortnightly":
      return value * 26;
    case "every_4_weeks":
      return value * 13;
    case "monthly":
      return value * 12;
    case "two_monthly":
      return value * 6;
    case "quarterly":
      return value * 4;
    case "half_yearly":
    case "semi_annually":
      return value * 2;
    case "annually":
    case "yearly":
    default:
      return value;
  }
}

function monthsToYears(months: number): number {
  return Math.max(1, Math.round(months / 12));
}

function ageFromEpoch(value: string): number {
  const epoch = Number(value);
  if (!Number.isFinite(epoch) || epoch <= 0) return 35;
  const birthDate = new Date(epoch * 1000);
  const now = new Date();
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const hasHadBirthday =
    now.getUTCMonth() > birthDate.getUTCMonth() ||
    (now.getUTCMonth() === birthDate.getUTCMonth() && now.getUTCDate() >= birthDate.getUTCDate());
  if (!hasHadBirthday) age -= 1;
  return Math.min(100, Math.max(18, age));
}

function monthsSinceEpoch(value: unknown): number | null {
  const epoch = Number(value);
  if (!Number.isFinite(epoch) || epoch <= 0) return null;
  const start = new Date(epoch * 1000);
  const now = new Date();
  let months = (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + now.getUTCMonth() - start.getUTCMonth();
  if (now.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

function yes(value: unknown): boolean {
  return ["yes", "y", "true", "1"].includes(normalized(value));
}

function hasValue(value: unknown): boolean {
  return value != null && rawString(value) !== "";
}

function optionalString(value: unknown): string | undefined {
  const text = rawString(value);
  return text ? text : undefined;
}

function optionalMoney(value: unknown): number | undefined {
  const amount = rawNumber(value, Number.NaN);
  return Number.isFinite(amount) ? amount : undefined;
}

function rawNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/,/g, "");
    if (!trimmed) return fallback;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function rawString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function normalized(value: unknown): string {
  return rawString(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function rawArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nonNegative(value: number): number {
  return Math.max(0, Math.round(value));
}

function roundPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

