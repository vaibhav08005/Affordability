import type { MortgagePurpose, RepaymentType } from "../../domain/contracts.js";

export const SANTANDER_CALCULATOR_URL =
  "https://www.santanderforintermediaries.co.uk/calculators-and-forms/affordability";

export const SANTANDER_CALCULATOR_NODE_ID = 2045;
export const SANTANDER_CALCULATOR_APP_ID = "AffordabilityCalculator";
export const SANTANDER_CALCULATOR_LATEST_VERSION = "27/03/2026";
export const SANTANDER_CMS_ENDPOINT = "/umbraco/api/affordability-calculator/cms-values/2045";
export const SANTANDER_RESULT_ENDPOINT = "/umbraco/api/affordability-calculator/calculate";

export const applicantTypeLabels = {
  single: ["Single"],
  joint: ["Joint"]
} as const;

export const mortgageTypeLabels: Record<MortgagePurpose, string[]> = {
  purchase: ["Purchase"],
  remortgage_no_additional_borrowing: ["Remortgage"],
  remortgage_capital_raising: ["Remortgage"],
  further_advance: ["Remortgage"]
};

export const remortgageReasonLabels: Record<Exclude<MortgagePurpose, "purchase">, string[]> = {
  remortgage_no_additional_borrowing: ["Remortgage - no additional borrowing", "No additional borrowing"],
  remortgage_capital_raising: ["Remortgage - with additional borrowing", "With additional borrowing"],
  further_advance: ["Remortgage - with additional borrowing", "With additional borrowing"]
};

export const repaymentMethodLabels: Record<RepaymentType, string[]> = {
  capital_and_interest: ["Capital and interest"],
  interest_only: [
    "Interest only - sale of mortgaged property",
    "Interest only - endowment or investment",
    "Interest only - Sale of the mortgaged property"
  ],
  part_and_part: [
    "Part and part - sale of mortgaged property",
    "Part and part - endowment or investment"
  ]
};

export const otherPropertyUseLabels = {
  alreadyLet: "Already let",
  toBeLet: "To be let",
  holidayHomeOrSecondHome: "Holiday home/second home",
  dependantRelativeHome: "Home for dependant relative"
} as const;

export const propertyTypeLabels = [
  "Semi-detached/link-detached house",
  "Semi-detached bungalow",
  "Detached/chalet bungalow",
  "Detached house",
  "Terraced/end-terraced/bungalow",
  "Converted flat/maisonette",
  "Purpose built flat/maisonette",
  "Commercial"
] as const;

export const bedroomLabels = ["1", "2", "3", "4", "5", "More than 5"] as const;

export const otherPropertyRepaymentLabels: Record<RepaymentType, string[]> = {
  capital_and_interest: ["Capital and interest"],
  interest_only: ["Interest only"],
  part_and_part: ["Part and part"]
};

export const incomeFrequencyLabels = [
  "Monthly",
  "Four-weekly",
  "Fortnightly",
  "Weekly",
  "Quarterly",
  "Annually",
  "Other"
] as const;

export function dependantOptionLabels(count: number): string[] {
  if (count > 20) return ["21+"];
  return [String(Math.max(0, count))];
}
