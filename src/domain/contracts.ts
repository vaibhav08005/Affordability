export type LenderId =
  | "halifax"
  | "barclays"
  | "natwest"
  | "hsbc"
  | "santander"
  | "nationwide"
  | "skipton"
  | "virgin_money"
  | "kensington";

export type RunStatus = "success" | "failed";

export type MortgagePurpose =
  | "purchase"
  | "remortgage_no_additional_borrowing"
  | "remortgage_capital_raising"
  | "further_advance";

export type CustomerType = "first_time_buyer" | "home_mover";
export type RepaymentType = "capital_and_interest" | "interest_only" | "part_and_part";
export type Tenure = "freehold" | "leasehold" | "outright_or_absolute_ownership";
export type EpcRating = "unknown" | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "exempt";
export type EmploymentType = "employed" | "self_employed" | "pension" | "other";
export type SelfEmploymentType = "sole_trader" | "limited_company" | "partnership" | "llp";
export type SharedOwnershipScheme = "shared_ownership" | "shared_equity";
export type HalifaxOtherIncomeType =
  | "additional_duty_hours"
  | "attendance_allowance"
  | "carers_allowance"
  | "child_benefit"
  | "child_tax_credit"
  | "colleague_flexible_benefit"
  | "constant_attendance_allowance"
  | "disability_living_allowance"
  | "employment_support_allowance"
  | "flight_pay_allowance"
  | "income_support"
  | "industrial_injuries_disablement_benefit"
  | "investment_income"
  | "maintenance"
  | "mortgage_subsidy"
  | "nursing_bank"
  | "personal_independence_payment"
  | "rental_income_btl"
  | "shift_allowance"
  | "town_area_or_car_allowance"
  | "trust_income"
  | "universal_credit"
  | "widowed_parents_allowance"
  | "working_tax_credit";

export interface LenderReadyInput {
  lender: LenderId;
  case: {
    journey: string;
    applicationType: "single" | "joint";
    numberOfApplicants: 1 | 2;
    mortgagePurpose: MortgagePurpose;
    customerType: CustomerType;
    repaymentType: RepaymentType;
    termYears: number;
    sharedOwnershipOrEquity: boolean;
    sharedOwnershipScheme?: SharedOwnershipScheme;
    monthlySharedOwnershipRent?: number;
    hasInterestOnly: boolean;
    interestOnlyLoanAmount?: number;
    monthlyRepaymentPlanPremium?: number;
  };
  property: {
    isInScotland: boolean;
    tenure: Tenure;
    epcRating: EpcRating;
  };
  loan: {
    propertyValue: number;
    loanAmount: number;
    currentBalance?: number;
    monthlyRepayment?: number;
    currentLender?: string;
  };
  household: {
    dependants: Array<{
      age: number;
      relationship?: string;
    }>;
  };
  applicants: Applicant[];
  outgoings: {
    monthlyLoanRepayments: number;
    creditCardBalances: number;
    overdraftBalances: number;
    otherMonthlyOutgoings: number;
    monthlyBuyToLetPayments: number;
    otherMortgageCommitments: OtherMortgageCommitment[];
  };
  otherProperties: OtherProperty[];
}

export interface Applicant {
  index: 1 | 2;
  dateOfBirth?: string;
  age: number;
  retirementAge?: number;
  employment: {
    type: EmploymentType;
    isContractor?: boolean;
    businessType?: SelfEmploymentType;
    netProfitCurrentYear?: number;
    netProfitPreviousYear?: number;
    annualGrossIncome?: number;
    annualOvertime?: number;
    annualBonus?: number;
    annualCommission?: number;
    annualPensionIncome?: number;
    otherAnnualPensionIncome?: number;
  };
  otherIncome: Array<{
    type: HalifaxOtherIncomeType;
    annualAmount: number;
  }>;
}

export interface OtherProperty {
  isRental: boolean;
  propertyValue: number;
  monthlyMortgagePayment: number;
  monthlyRent?: number;
  currentBalance?: number;
  interestOnlyBalance?: number;
  remainingTermYears?: number;
  repaymentType?: RepaymentType;
}

export interface OtherMortgageCommitment {
  outstandingBalance: number;
  remainingTermYears: number;
}

export interface AutomationEvidence {
  screenshotPath?: string;
  timestamp: string;
}

export interface AffordabilityResult {
  lender: LenderId;
  status: RunStatus;
  maximumBorrowing: number | null;
  monthlyPayment: number | null;
  messages: string[];
  evidence: AutomationEvidence;
  error?: {
    category: "validation" | "navigation" | "field_fill" | "calculate" | "result_extraction" | "lender_unavailable";
    message: string;
  };
}
