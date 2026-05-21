import type {
  CustomerType,
  EpcRating,
  EmploymentType,
  MortgagePurpose,
  RepaymentType,
  SelfEmploymentType,
  Tenure
} from "../../domain/contracts.js";

export const NATWEST_CALCULATOR_URL = "https://spa.mortgages.natwest.com/calculator/residential-affordability";

export const mortgagePurposeLabels: Record<MortgagePurpose, string[]> = {
  purchase: ["Purchase", "Residential purchase", "Buying a property"],
  remortgage_no_additional_borrowing: ["Remortgage", "Remortgage with no additional borrowing", "Like for like remortgage"],
  remortgage_capital_raising: ["Remortgage with additional borrowing", "Remortgage with capital raising", "Capital raising"],
  further_advance: ["Additional borrowing", "Further advance"]
};

export const customerTypeLabels: Record<CustomerType, string[]> = {
  first_time_buyer: ["First time buyer", "First-time buyer"],
  home_mover: ["Home mover", "Moving home", "Existing homeowner"]
};

export const repaymentTypeLabels: Record<RepaymentType, string[]> = {
  capital_and_interest: ["Capital and interest", "Repayment", "Capital repayment"],
  interest_only: ["Interest only", "Interest-only"],
  part_and_part: ["Part and part", "Repayment and interest only", "Combination"]
};

export const tenureLabels: Record<Tenure, string[]> = {
  freehold: ["Freehold"],
  leasehold: ["Leasehold"],
  outright_or_absolute_ownership: ["Outright or absolute ownership", "Absolute ownership", "Freehold"]
};

export const epcLabels: Record<EpcRating, string[]> = {
  unknown: ["Unknown", "I don't know", "Not known"],
  A: ["A"],
  B: ["B"],
  C: ["C"],
  D: ["D"],
  E: ["E"],
  F: ["F"],
  G: ["G"],
  exempt: ["Exempt"]
};

export const employmentStatusLabels: Record<EmploymentType, string[]> = {
  employed: ["Employed", "Permanent employed"],
  self_employed: ["Self-employed", "Self employed"],
  pension: ["Retired", "Pension", "Non-employed or retired"],
  other: ["Other", "Non-employed or retired"]
};

export const selfEmploymentLabels: Record<SelfEmploymentType, string[]> = {
  sole_trader: ["Sole trader"],
  limited_company: ["Limited company", "Director of limited company"],
  partnership: ["Partnership", "Partner"],
  llp: ["LLP", "Limited liability partnership"]
};
