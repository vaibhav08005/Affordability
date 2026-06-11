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

export interface KensingtonRawMappingResult {
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

export function mapKensingtonRawInput(raw: RawRecord): KensingtonRawMappingResult {
  const issues: MappingIssue[] = [];
  const numberOfApplicants = applicantCount(raw);
  const mortgagePurpose = kensingtonMortgagePurpose(raw);
  const repaymentType = kensingtonRepaymentType(raw.var_new_repayment_type ?? raw.var_repayment_type);
  const propertyValue = kensingtonPropertyValue(raw, mortgagePurpose);
  const loanAmount = kensingtonLoanAmount(raw, mortgagePurpose, propertyValue);
  const postcode = propertyPostcode(raw);
  const isInScotland = isScottishPostcode(postcode);
  const sharedOwnershipOrEquity = isSharedOwnershipOrEquity(raw);
  const sharedOwnershipScheme = sharedOwnershipOrEquity ? sharedScheme(raw) : undefined;
  const applicants = mapKensingtonApplicants(raw, numberOfApplicants, issues);
  const otherProperties = mapKensingtonOtherProperties(raw);
  const outgoings = mapKensingtonOutgoings(raw, otherProperties);

  const input: LenderReadyInput = {
    lender: "kensington",
    case: {
      journey: kensingtonJourney(raw, mortgagePurpose),
      applicationType: numberOfApplicants === 1 ? "single" : "joint",
      numberOfApplicants,
      mortgagePurpose,
      customerType: kensingtonCustomerType(raw),
      repaymentType,
      termYears: monthsToYears(rawNumber(raw.var_new_mortgage_term ?? raw.var_mortgage_term, 300)),
      sharedOwnershipOrEquity,
      sharedOwnershipScheme,
      monthlySharedOwnershipRent: sharedOwnershipScheme === "shared_ownership" ? rawNumber(raw.var_rent_income, 0) : undefined,
      sharedEquityCustomerStakePercent: sharedOwnershipScheme === "shared_equity" ? customerStakePercent(raw, propertyValue) : undefined,
      monthlySharedEquityInterestPayment: sharedOwnershipScheme === "shared_equity" ? 0 : undefined,
      equityLoanBalance: sharedOwnershipScheme === "shared_equity"
        ? rawNumber(raw.var_htb_loan_amount ?? raw.var_shared_equity_loan_amount, 0)
        : undefined,
      equityLoanInterestRatePercent: sharedOwnershipScheme === "shared_equity" ? 0 : undefined,
      hasInterestOnly: repaymentType === "interest_only" || repaymentType === "part_and_part",
      interestOnlyLoanAmount: interestOnlyAmount(raw, repaymentType, loanAmount),
      monthlyRepaymentPlanPremium: repaymentPlanPremium(raw, applicants, repaymentType)
    },
    property: {
      isInScotland,
      tenure: kensingtonTenure(raw, isInScotland),
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
      dependants: kensingtonDependants(raw, numberOfApplicants)
    },
    applicants,
    outgoings,
    otherProperties
  };

  recordKensingtonAssumptions(raw, input, postcode, issues);

  return { input, issues: dedupeIssues(issues) };
}

function kensingtonMortgagePurpose(raw: RawRecord): MortgagePurpose {
  const journey = normalized(raw.var_journey);
  const mortgageType = normalized(raw.var_mortgage_type);
  if (["ftb", "first_time_buyer", "hm", "home_mover", "moving_home", "purchase"].includes(journey) || mortgageType === "moving_home") {
    return "purchase";
  }
  if (["further_advance", "fa"].includes(journey) || mortgageType === "further_advance") return "further_advance";
  const extraBorrowing = rawNumber(raw.var_equity_release_amount ?? raw.var_additional_borrowing ?? raw.var_add_borrow_amount, 0);
  return extraBorrowing > 0 || hasValue(raw.var_add_borrow_details)
    ? "remortgage_capital_raising"
    : "remortgage_no_additional_borrowing";
}

function kensingtonJourney(raw: RawRecord, mortgagePurpose: MortgagePurpose): string {
  const base = rawString(raw.var_journey) || rawString(raw.var_mortgage_type) || mortgagePurpose;
  const initialPeriod = normalized(raw.var_length_of_intro_period ?? raw.var_initial_period ?? raw.var_fixed_rate_period);
  if (/2|two/.test(initialPeriod) && !/2\s*(?:yr|year)|two/i.test(base)) return `${base} 2yr`;
  if (/5|five/.test(initialPeriod) && !/5\s*(?:yr|year)|five/i.test(base)) return `${base} 5yr`;
  return base;
}

function kensingtonCustomerType(raw: RawRecord): "first_time_buyer" | "home_mover" {
  const journey = normalized(raw.var_journey);
  const ownershipType = normalized(raw.var_ownership_type_ftb);
  if (journey === "ftb" || ownershipType.includes("first_time")) return "first_time_buyer";
  return "home_mover";
}

function kensingtonRepaymentType(value: unknown): RepaymentType {
  const repayment = normalized(value);
  if (repayment.includes("interest_only") || repayment === "io") return "interest_only";
  if (repayment.includes("part")) return "part_and_part";
  return "capital_and_interest";
}

function kensingtonPropertyValue(raw: RawRecord, mortgagePurpose: MortgagePurpose): number {
  const ownership = normalized(raw.var_ownership_type ?? raw.var_ownership_type_ftb);
  const shareValue = rawNumber(raw.var_value_of_share, 0);
  if (ownership.includes("shared_ownership") && shareValue > 0) return shareValue;
  if (mortgagePurpose === "purchase") return rawNumber(raw.var_property_value, 0);
  return rawNumber(raw.var_value_of_share, rawNumber(raw.var_property_value, 0));
}

function kensingtonLoanAmount(raw: RawRecord, mortgagePurpose: MortgagePurpose, propertyValue: number): number {
  const deposit = rawNumber(raw.var_deposit, 0) || sumDepositSources(raw);
  const ownership = normalized(raw.var_ownership_type ?? raw.var_ownership_type_ftb);
  const additionalBorrowing = rawNumber(raw.var_equity_release_amount ?? raw.var_additional_borrowing ?? raw.var_add_borrow_amount, 0);
  const payDown = rawNumber(raw.var_pay_down_amount, 0);

  if (mortgagePurpose === "purchase") {
    const equityLoan = ownership.includes("shared") || ownership.includes("equity") || ownership.includes("htb") || ownership.includes("help_to_buy")
      ? rawNumber(raw.var_htb_loan_amount ?? raw.var_shared_equity_loan_amount, 0)
      : 0;
    return nonNegative(propertyValue - deposit - equityLoan);
  }

  if (mortgagePurpose === "further_advance") return nonNegative(additionalBorrowing);

  return nonNegative(rawNumber(raw.var_remo_remaining_balance, 0) - payDown + additionalBorrowing);
}

function isSharedOwnershipOrEquity(raw: RawRecord): boolean {
  const ownership = normalized(raw.var_ownership_type ?? raw.var_ownership_type_ftb);
  if (!ownership || ownership === "standard") return false;
  return ["shared", "equity", "htb", "help_to_buy", "forces"].some((token) => ownership.includes(token));
}

function sharedScheme(raw: RawRecord): "shared_ownership" | "shared_equity" {
  const ownership = normalized(raw.var_ownership_type ?? raw.var_ownership_type_ftb);
  return ownership.includes("shared_ownership") ? "shared_ownership" : "shared_equity";
}

function customerStakePercent(raw: RawRecord, propertyValue: number): number {
  const shareValue = rawNumber(raw.var_value_of_share, 0);
  if (propertyValue > 0 && shareValue > 0) return roundPercent((shareValue / propertyValue) * 100);
  const equityLoan = rawNumber(raw.var_htb_loan_amount ?? raw.var_shared_equity_loan_amount, 0);
  if (propertyValue > 0 && equityLoan > 0) return roundPercent(((propertyValue - equityLoan) / propertyValue) * 100);
  return 100;
}

function interestOnlyAmount(raw: RawRecord, repaymentType: RepaymentType, loanAmount: number): number | undefined {
  if (repaymentType === "capital_and_interest") return undefined;
  if (repaymentType === "interest_only") return loanAmount;
  return rawNumber(raw.var_new_interest_only_amount ?? raw.var_interest_only_amount, 0);
}

function repaymentPlanPremium(raw: RawRecord, applicants: Applicant[], repaymentType: RepaymentType): number | undefined {
  if (repaymentType === "capital_and_interest") return undefined;
  const explicit = optionalMoney(raw.var_repay_vehicle_mthly_contribution);
  if (explicit != null) return explicit;
  return applicants.reduce((sum, applicant) => {
    const prefix = `var_appl${applicant.index}`;
    return sum + rawNumber(raw[`${prefix}_outgoings_pension_contribution`], 0) + rawNumber(raw[`${prefix}_outgoings_investments`], 0);
  }, 0);
}

function kensingtonTenure(raw: RawRecord, isInScotland: boolean): Tenure {
  const tenure = normalized(raw.var_property_details_tenure);
  if (tenure.includes("lease") || tenure.includes("commonhold")) return "leasehold";
  if (isInScotland) return "outright_or_absolute_ownership";
  return "freehold";
}

function mapKensingtonApplicants(raw: RawRecord, numberOfApplicants: 1 | 2, issues: MappingIssue[]): Applicant[] {
  const applicants: Applicant[] = [];
  for (let index = 1; index <= numberOfApplicants; index += 1) {
    applicants.push(kensingtonApplicant(raw, index as 1 | 2, issues));
  }
  return applicants;
}

function kensingtonApplicant(raw: RawRecord, index: 1 | 2, issues: MappingIssue[]): Applicant {
  const prefix = `var_appl${index}`;
  const dateOfBirth = optionalString(raw[`${prefix}_date_of_birth`]);
  if (!dateOfBirth) {
    issues.push({
      field: `${prefix}_date_of_birth`,
      message: "Date of birth missing; applicant age defaulted to 35 for Kensington eligibility."
    });
  }

  return {
    index,
    dateOfBirth,
    age: dateOfBirth ? ageFromEpoch(dateOfBirth) : 35,
    retirementAge: rawNumber(raw[`${prefix}_retirement_age`], 70),
    monthlyPensionContribution: optionalMoney(raw[`${prefix}_outgoings_pension_contribution`]),
    employment: kensingtonEmployment(raw, index, issues),
    otherIncome: kensingtonOtherIncome(raw, index)
  };
}

function kensingtonEmployment(raw: RawRecord, index: 1 | 2, issues: MappingIssue[]): Applicant["employment"] {
  const prefix = `var_appl${index}`;
  const employmentText = normalized(raw[`${prefix}_employment_details_employment_type`]);
  const employedType = normalized(raw[`${prefix}_employment_details_employed_type`]);
  const contractType = normalized(raw[`${prefix}_employment_details_contract_type`]);
  const businessType = kensingtonBusinessType(raw[`${prefix}_business_setup_type`], employmentText);
  const shareholding = rawNumber(raw[`${prefix}_employed_company_details_ownership_percentage`], 0);
  const tenPercentShare = yes(raw[`${prefix}_employment_details_is_ten_percent`]);
  const isContractor = employmentText.includes("contractor") || employedType.includes("contract") || contractType.includes("contract");
  const type = kensingtonEmploymentType(employmentText, businessType, shareholding, tenPercentShare, isContractor);
  const employmentMonths = monthsSinceEpoch(raw[`${prefix}_employed_permanent_temporary_start_date`]);
  const selfEmploymentMonths = monthsSinceEpoch(raw[`${prefix}_business_start_date`]);

  if (employmentMonths != null && employmentMonths < 3 && type === "employed") {
    issues.push({
      field: `${prefix}_employed_permanent_temporary_start_date`,
      message: "Kensington workbook expects current employment history to be considered; income is preserved, but short employment should be reviewed."
    });
  }

  if (selfEmploymentMonths != null && selfEmploymentMonths < 24 && type === "self_employed") {
    issues.push({
      field: `${prefix}_business_start_date`,
      message: "Kensington workbook generally expects two years of self-employed history; mapped profits are preserved for adapter validation."
    });
  }

  const employment: Applicant["employment"] = {
    type,
    isContractor,
    annualGrossIncome: kensingtonBasicSalary(raw, prefix, isContractor),
    annualOvertime: kensingtonOvertimeAndOtherAllowance(raw, prefix),
    annualBonus: lowerOfLatestAndAverage(
      annualiseForKensington(raw[`${prefix}_recent_nongtd_bonus`], raw[`${prefix}_recent_nongtd_bonus_frequency`]),
      annualiseForKensington(raw[`${prefix}_prev_nongtd_bonus`], raw[`${prefix}_prev_nongtd_bonus_frequency`])
    ),
    annualCommission: annualiseForKensington(raw[`${prefix}_recent_commission`], raw[`${prefix}_recent_commission_frequency`]),
    annualPensionIncome: rawNumber(raw[`${prefix}_mthly_pension`], 0) * 12,
    otherAnnualPensionIncome: 0
  };

  if (type === "self_employed") {
    employment.businessType = businessType ?? "sole_trader";
    const profits = kensingtonSelfEmployedIncome(raw, prefix, employment.businessType, shareholding);
    employment.netProfitCurrentYear = profits.current;
    employment.netProfitPreviousYear = profits.previous;
    if (employment.businessType === "limited_company" || employment.businessType === "llp") {
      employment.annualGrossIncome = rawNumber(raw[`${prefix}_business_salary`] ?? raw[`${prefix}_dir_partnr_curr_yr_salary`], 0);
    }
  }

  return employment;
}

function kensingtonEmploymentType(
  employmentText: string,
  businessType: SelfEmploymentType | undefined,
  shareholding: number,
  tenPercentShare: boolean,
  isContractor: boolean
): EmploymentType {
  if (["retired", "pension"].some((token) => employmentText.includes(token))) return "pension";
  if (["not_working", "unemployed", "student", "homemaker", "home_maker"].some((token) => employmentText.includes(token))) return "other";
  if (isContractor) return "other";
  if (businessType || employmentText.includes("self") || employmentText.includes("partner") || shareholding >= 20 || tenPercentShare) {
    return "self_employed";
  }
  return "employed";
}

function kensingtonBasicSalary(raw: RawRecord, prefix: string, isContractor: boolean): number {
  if (isContractor) {
    const rate = rawNumber(raw[`${prefix}_contract_details_rate_amount`], 0);
    const frequency = normalized(raw[`${prefix}_contract_details_rate_frequency`]);
    if (rate > 0) {
      if (frequency.includes("hour")) return Math.round(rate * 8 * 5 * 48);
      if (frequency.includes("week")) return Math.round(rate * 48);
      return Math.round(rate * 5 * 48);
    }
    const umbrellaOrEmployerSalary = rawNumber(raw[`${prefix}_contract_salary`] ?? raw[`${prefix}_gross_annual_salary`], 0);
    if (umbrellaOrEmployerSalary > 0) return umbrellaOrEmployerSalary;
  }

  return rawNumber(raw[`${prefix}_gross_annual_salary`], 0);
}

function kensingtonOvertimeAndOtherAllowance(raw: RawRecord, prefix: string): number {
  return annualiseForKensington(raw[`${prefix}_recent_overtime`], raw[`${prefix}_recent_overtime_frequency`]) +
    annualiseForKensington(raw[`${prefix}_recent_other_allowance`], raw[`${prefix}_recent_other_allowance_frequency`]);
}

function kensingtonSelfEmployedIncome(
  raw: RawRecord,
  prefix: string,
  businessType: SelfEmploymentType,
  shareholding: number
): { current: number; previous: number } {
  const salary = rawNumber(raw[`${prefix}_business_salary`] ?? raw[`${prefix}_dir_partnr_curr_yr_salary`], 0);
  const currentDividends = rawNumber(raw[`${prefix}_business_curr_yr_dividends`], 0);
  const previousDividends = rawNumber(raw[`${prefix}_business_prev_yr_dividends`] ?? raw[`${prefix}_business_curr_yr_dividends`], 0);
  const currentShareProfit = rawNumber(raw[`${prefix}_business_curr_yr_share_profit`] ?? raw[`${prefix}_business_curr_yr_net_profit`], 0);
  const previousShareProfit = rawNumber(raw[`${prefix}_business_prev_yr_share_profit`] ?? raw[`${prefix}_business_prev_yr_net_profit`], 0);

  if (businessType === "limited_company") {
    return {
      current: salary + (shareholding >= 50 ? Math.max(currentShareProfit, currentDividends) : currentDividends),
      previous: salary + (shareholding >= 50 ? Math.max(previousShareProfit, previousDividends) : previousDividends)
    };
  }

  if (businessType === "llp") {
    return {
      current: salary + (shareholding >= 25 ? Math.max(currentShareProfit, currentDividends) : currentDividends),
      previous: salary + (shareholding >= 25 ? Math.max(previousShareProfit, previousDividends) : previousDividends)
    };
  }

  const currentProfit = rawNumber(
    raw[`${prefix}_st_curr_yr_profit`] ??
      raw[`${prefix}_business_curr_yr_share_profit`] ??
      raw[`${prefix}_business_curr_yr_net_profit`],
    0
  );
  const previousProfit = rawNumber(
    raw[`${prefix}_st_prev_yr_profit`] ??
      raw[`${prefix}_business_prev_yr_share_profit`] ??
      raw[`${prefix}_business_prev_yr_net_profit`],
    0
  );

  return {
    current: lowerOfLatestAndAverage(currentProfit, previousProfit),
    previous: previousProfit
  };
}

function kensingtonOtherIncome(raw: RawRecord, index: 1 | 2): Applicant["otherIncome"] {
  const prefix = `var_appl${index}`;
  const entries: Applicant["otherIncome"] = [];
  const totalEmploymentIncome = rawNumber(raw[`${prefix}_gross_annual_salary`], 0);
  const hasEligibleChild = rawArray(raw[`${prefix}_dependents_details`])
    .some((item) => rawNumber((item as RawRecord).age, 99) < 13);

  addIncome(entries, "town_area_or_car_allowance", annualiseForKensington(raw[`${prefix}_recent_regular_allowance`], raw[`${prefix}_recent_regular_allowance_frequency`]));
  addIncome(entries, "additional_duty_hours", annualiseForKensington(raw[`${prefix}_recent_additional_hours`], raw[`${prefix}_recent_additional_hours_frequency`]));
  addIncome(entries, "nursing_bank", annualiseForKensington(raw[`${prefix}_recent_nursing_bank`], raw[`${prefix}_recent_nursing_bank_frequency`]));
  addIncome(entries, "rental_income_btl", rawNumber(raw[`${prefix}_land_curr_profit`], 0) * 12);
  if (hasEligibleChild && totalEmploymentIncome < 50000) {
    addIncome(entries, "child_benefit", annualiseForKensington(raw[`${prefix}_child_benefits_amt`], raw[`${prefix}_child_benefits_frequency`]));
  }
  addIncome(entries, "child_tax_credit", annualiseForKensington(raw[`${prefix}_child_tax_credits`], raw[`${prefix}_child_tax_credits_frequency`]));
  addIncome(entries, "employment_support_allowance", annualiseForKensington(raw[`${prefix}_employment_and_support_allowance`], raw[`${prefix}_employment_and_support_allowance_frequency`]));
  addIncome(entries, "personal_independence_payment", annualiseForKensington(raw[`${prefix}_personal_independence_payment`], raw[`${prefix}_personal_independence_payment_frequency`]));
  addIncome(entries, "disability_living_allowance", annualiseForKensington(raw[`${prefix}_disability_living_allowance`], raw[`${prefix}_disability_living_allowance_frequency`]));
  addIncome(entries, "carers_allowance", annualiseForKensington(raw[`${prefix}_carers_allowance`], raw[`${prefix}_carers_allowance_frequency`]));
  addIncome(entries, "income_support", annualiseForKensington(raw[`${prefix}_income_support`], raw[`${prefix}_income_support_frequency`]));
  addIncome(entries, "universal_credit", annualiseForKensington(raw[`${prefix}_other_state_benefits`], raw[`${prefix}_other_state_benefits_frequency`]));
  addIncome(entries, "maintenance", rawNumber(raw[`${prefix}_mthly_maint_amt`], 0) * 12);
  addIncome(entries, "investment_income", annualiseForKensington(raw[`${prefix}_investment_income`], raw[`${prefix}_investment_income_frequency`]));
  addIncome(entries, "trust_income", annualiseForKensington(raw[`${prefix}_trust_income`], raw[`${prefix}_trust_income_frequency`]));

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

function kensingtonDependants(raw: RawRecord, numberOfApplicants: 1 | 2): LenderReadyInput["household"]["dependants"] {
  const dependants = [...rawArray(raw.var_appl1_dependents_details), ...rawArray(raw.var_appl2_dependents_details)].map((item) => {
    const dependant = item as RawRecord;
    return {
      age: rawNumber(dependant.age, 0),
      relationship: optionalString(dependant.relationship)
    };
  });
  if (numberOfApplicants === 1) return dependants;

  const relationship = normalized(raw.var_appl1_joint_rel_status);
  if (["spouse", "civil_partner"].includes(relationship)) {
    return dependants.filter((dependant) => !["spouse", "civil_partner"].includes(normalized(dependant.relationship)));
  }
  if (relationship.includes("live") || relationship.includes("partner")) {
    return dependants.filter((dependant) => normalized(dependant.relationship) !== "partner");
  }
  return dependants;
}

function mapKensingtonOutgoings(
  raw: RawRecord,
  otherProperties: LenderReadyInput["otherProperties"]
): LenderReadyInput["outgoings"] {
  const childcare = sumApplicantNumbers(raw, "outgoings_childcare_cost");
  const education = sumApplicantNumbers(raw, "outgoings_nursery_school_fee");
  const maintenance = sumApplicantNumbers(raw, "outgoings_maintenance_payment");
  const councilTax = rawNumber(raw.var_property_details_mthly_council_tax, 0);
  const buildingInsurance = rawNumber(raw.var_property_details_mthly_bldg_ins, 0);
  const groundRent = rawNumber(raw.var_property_details_mthly_ground_rent ?? raw.var_property_details_mthly_grnd_rent, 0);
  const serviceCharge = rawNumber(raw.var_property_details_mthly_service_charge ?? raw.var_property_details_mthly_serv_charges, 0);
  const insuranceAndPensions =
    sumApplicantNumbers(raw, "outgoings_pension_contribution") +
    sumApplicantNumbers(raw, "outgoings_investments") +
    buildingInsurance;

  return {
    monthlyLoanRepayments: kensingtonCreditCommitmentPayments(raw),
    creditCardBalances: sumCreditCommitments(raw, ["cards", "card", "credit_card", "store_card"]),
    overdraftBalances: sumCreditCommitments(raw, ["overdraft", "overdrafts"]),
    otherMonthlyOutgoings:
      childcare +
      education +
      maintenance +
      insuranceAndPensions +
      councilTax +
      groundRent +
      serviceCharge,
    monthlyBuyToLetPayments: 0,
    monthlyCouncilTax: councilTax,
    monthlyBuildingInsurance: buildingInsurance,
    monthlyGroundRent: groundRent,
    monthlyServiceCharge: serviceCharge,
    monthlyChildcareAndEducation: childcare,
    monthlySchoolFees: education,
    monthlyMaintenancePayments: maintenance,
    monthlyInsuranceAndPensions: insuranceAndPensions,
    otherMortgageCommitments: otherProperties
      .filter((property) => !property.isRental)
      .map((property) => ({
        outstandingBalance: property.currentBalance ?? 0,
        remainingTermYears: property.remainingTermYears ?? 1
      }))
      .filter((commitment) => commitment.outstandingBalance > 0)
  };
}

function kensingtonCreditCommitmentPayments(raw: RawRecord): number {
  return sumCreditCommitments(raw, ["loans", "loan", "student_loans", "student_loan", "secured_loans", "hire_purchase", "lease", "buy_now_pay_later"]) +
    sumApplicantNumbers(raw, "outgoings_other_committed_exp");
}

function mapKensingtonOtherProperties(raw: RawRecord): LenderReadyInput["otherProperties"] {
  return rawArray(raw.var_other_properties)
    .map((item) => item as RawRecord)
    .filter((property) => yes(property.mortgage_status))
    .map((property) => {
      const isRental = isRentalProperty(property);
      const balance = rawNumber(property.current_balance, 0);
      const monthlyRent = rawNumber(property.monthly_rent, 0);
      const monthlyRepayment = rawNumber(property.monthly_repayment, 0);
      const btlShortfall = isRental ? buyToLetShortfall(property) : monthlyRepayment;
      return {
        isRental,
        propertyValue: rawNumber(property.property_value, balance),
        monthlyMortgagePayment: btlShortfall,
        monthlyRent: isRental ? monthlyRent : undefined,
        currentBalance: optionalMoney(property.current_balance),
        currentLender: optionalString(property.current_lender),
        interestOnlyBalance: optionalMoney(property.io_balance),
        remainingTermYears: rawNumber(property.remaining_term, 0) > 0 ? monthsToYears(rawNumber(property.remaining_term, 0)) : undefined,
        repaymentType: kensingtonRepaymentType(property.repayment_type)
      };
    });
}

function buyToLetShortfall(property: RawRecord): number {
  const rent = rawNumber(property.monthly_rent, 0);
  const payment = rawNumber(property.monthly_repayment, 0);
  const costs = rawNumber(property.monthly_council_tax, 0) + rawNumber(property.monthly_building_insurance, 0);
  return Math.max(0, payment + costs - rent);
}

function isRentalProperty(property: RawRecord): boolean {
  const occupancy = normalized(property.occupancy_status);
  return yes(property.is_rental_property) || ["let", "to_be_let", "rental_property_already_let"].includes(occupancy);
}

function sumCreditCommitments(raw: RawRecord, types: string[]): number {
  let total = 0;
  for (const applicantIndex of [1, 2]) {
    for (const item of rawArray(raw[`var_appl${applicantIndex}_credit_commitments`])) {
      const commitment = item as RawRecord;
      if (!yes(commitment.include_afford)) continue;
      if (!types.includes(normalized(commitment.type))) continue;
      const balanceType = types.some((type) => type.includes("card") || type.includes("overdraft"));
      total += balanceType ? rawNumber(commitment.current_balance, 0) : rawNumber(commitment.monthly_payment, 0);
    }
  }
  return total;
}

function kensingtonBusinessType(value: unknown, employmentText: string): SelfEmploymentType | undefined {
  const businessType = normalized(value);
  const combined = `${businessType}_${employmentText}`;
  if (combined.includes("llp")) return "llp";
  if (combined.includes("limited") || combined.includes("director")) return "limited_company";
  if (combined.includes("partnership") || combined.includes("partner")) return "partnership";
  if (combined.includes("sole")) return "sole_trader";
  return undefined;
}

function recordKensingtonAssumptions(
  raw: RawRecord,
  input: LenderReadyInput,
  postcode: string,
  issues: MappingIssue[]
): void {
  if (!postcode) {
    issues.push({
      field: "property.postcode",
      message: "Property postcode was not present; Kensington adapter chooses its default postcode by Scotland flag."
    });
  }

  if (!hasValue(raw.var_length_of_intro_period) && !hasValue(raw.var_initial_period) && !hasValue(raw.var_fixed_rate_period)) {
    issues.push({
      field: "case.journey",
      message: "Initial rate period was not present; Kensington product selection defaults to the adapter's 5 year product path."
    });
  }

  if (input.case.sharedOwnershipScheme === "shared_equity") {
    issues.push({
      field: "case.sharedOwnershipScheme",
      message: "Kensington workbook maps Help to Buy/shared equity to a dedicated product range; current adapter selects the available Kensington product by LTV and initial period."
    });
  }

  if (input.outgoings.otherMonthlyOutgoings > 0) {
    issues.push({
      field: "outgoings",
      message: "Kensington workbook has separate ground rent/service, childcare, maintenance, school fees, and other expenditure rows; shared lender-ready output stores both optional splits and the combined otherMonthlyOutgoings fallback."
    });
  }

  if (input.otherProperties.some((property) => property.isRental)) {
    issues.push({
      field: "otherProperties",
      message: "Kensington workbook uses buy-to-let shortfall in monthly credit commitments; rental property monthlyMortgagePayment is mapped to the shortfall for Kensington compatibility."
    });
  }

  if (input.applicants.some((applicant) => applicant.otherIncome.filter((income) => !["town_area_or_car_allowance", "shift_allowance"].includes(income.type)).length > 1)) {
    issues.push({
      field: "applicants.otherIncome",
      message: "Kensington adapter aggregates non-allowance other income into one calculator row even though the mapper preserves individual lender-ready income categories."
    });
  }
}

function annualiseForKensington(amount: unknown, frequency: unknown): number {
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

function lowerOfLatestAndAverage(latest: number, previous: number): number {
  if (latest === 0 && previous === 0) return 0;
  if (previous <= 0) return Math.round(latest);
  return Math.round(latest < previous ? latest : (latest + previous) / 2);
}

function applicantCount(raw: RawRecord): 1 | 2 {
  return rawNumber(raw.var_no_of_applicants, 1) >= 2 ? 2 : 1;
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

function dedupeIssues(issues: MappingIssue[]): MappingIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.field}\0${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
