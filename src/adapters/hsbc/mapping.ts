import type {
  CustomerType,
  EmploymentType,
  MortgagePurpose,
  RepaymentType,
  SelfEmploymentType
} from "../../domain/contracts.js";

export const HSBC_CALCULATOR_URL =
  "https://www.hsbc.co.uk/services/global-mortgages/ntb/affordability-calculator/";

export const applicationTypeLabels: Record<MortgagePurpose, string[]> = {
  purchase: ["Buying first home", "Home mover / Buy new property"],
  remortgage_no_additional_borrowing: ["Remortgage an existing property"],
  remortgage_capital_raising: ["Remortgage an existing property"],
  further_advance: ["Remortgage an existing property"]
};

export const customerTypeApplicationLabels: Record<CustomerType, string[]> = {
  first_time_buyer: ["Buying first home"],
  home_mover: ["Home mover / Buy new property"]
};

export const repaymentBasisLabels: Record<RepaymentType, string[]> = {
  capital_and_interest: ["No"],
  interest_only: ["Yes"],
  part_and_part: ["Yes"]
};

export const residentialStatusLabels = {
  default: ["Owner Occupier", "Living with a Parent", "Tenant", "Unknown / Other"],
  first_time_buyer: ["Living with a Parent", "Tenant", "Unknown / Other"],
  home_mover: ["Owner Occupier"],
  halls: ["Halls of Residence"],
  tenant: ["Tenant"]
} as const;

export const employmentStatusLabels: Record<EmploymentType, string[]> = {
  employed: ["Employed full time", "Employed key/part time"],
  self_employed: [
    "Self-employed - Ltd Company Director/Shareholder",
    "Self-employed - Sole Trader/Partnership"
  ],
  pension: ["Receiving pension/disability"],
  other: ["Homemaker", "Student", "Unemployed"]
};

export const selfEmploymentStatusLabels: Record<SelfEmploymentType, string[]> = {
  sole_trader: ["Self-employed - Sole Trader/Partnership"],
  limited_company: ["Self-employed - Ltd Company Director/Shareholder"],
  partnership: ["Self-employed - Sole Trader/Partnership"],
  llp: ["Self-employed - Sole Trader/Partnership"]
};
