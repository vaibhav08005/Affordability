import type { EmploymentType, RepaymentType, SelfEmploymentType } from "../../domain/contracts.js";

export const SKIPTON_CALCULATOR_URL = "https://affordability.skipton-intermediaries.co.uk/";

export const regionValues = {
  default: "se",
  scotland: "sc",
  wales: "wa",
  northernIreland: "ni"
} as const;

export const repaymentTypeRadioIndex: Record<RepaymentType, number> = {
  capital_and_interest: 0,
  interest_only: 1,
  part_and_part: 2
};

export const employmentTypeRadioIndex: Record<EmploymentType, number> = {
  employed: 0,
  other: 1,
  pension: 2,
  self_employed: 3
};

export const selfEmploymentIncomeMode: Record<SelfEmploymentType, "profit" | "director"> = {
  sole_trader: "profit",
  partnership: "profit",
  llp: "profit",
  limited_company: "director"
};
