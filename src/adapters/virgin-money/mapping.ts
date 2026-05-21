import type { EmploymentType, MortgagePurpose, RepaymentType } from "../../domain/contracts.js";

export const VIRGIN_MONEY_CALCULATOR_URL =
  "https://intermediaries.virginmoney.com/affordability-calculator/residential/loan-details/";

export const loanTypeIds: Record<MortgagePurpose, "purchase" | "remortgage"> = {
  purchase: "purchase",
  remortgage_no_additional_borrowing: "remortgage",
  remortgage_capital_raising: "remortgage",
  further_advance: "remortgage"
};

export const repaymentTypeIds: Record<RepaymentType, string> = {
  capital_and_interest: "capital-and-interest",
  interest_only: "interest-only",
  part_and_part: "part-and-part"
};

export const employmentStatusValues: Record<EmploymentType, string> = {
  employed: "Employed",
  self_employed: "Self-employed",
  pension: "Retired",
  other: "Not Employed"
};

export const locationRadioIds = {
  england: "england-1-1",
  scotland: "scotland-1-1",
  wales: "wales-1-1",
  northernIreland: "northern-ireland-1-1"
} as const;
