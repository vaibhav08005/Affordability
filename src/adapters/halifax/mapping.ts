import type {
  CustomerType,
  EpcRating,
  HalifaxOtherIncomeType,
  MortgagePurpose,
  SelfEmploymentType,
  SharedOwnershipScheme,
  Tenure
} from "../../domain/contracts.js";

export const HALIFAX_LANDING_URL =
  "https://www.halifax-intermediaries.co.uk/tools-calculators/mortgage-affordability-calculator.html";
export const HALIFAX_CALCULATOR_URL = "https://www2.halifax-intermediariesonline.co.uk/tools/calculator/";

export const mortgagePurposeLabels: Record<MortgagePurpose, string> = {
  purchase: "Purchase",
  remortgage_no_additional_borrowing: "Remortgage with no additional borrowing",
  remortgage_capital_raising: "Remortgage with capital raising",
  further_advance: "Further advance"
};

export const customerTypeLabels: Record<CustomerType, string> = {
  first_time_buyer: "First-time buyer",
  home_mover: "Home mover"
};

export const tenureLabels: Record<Tenure, string> = {
  freehold: "Freehold",
  leasehold: "Leasehold",
  outright_or_absolute_ownership: "Outright or absolute ownership"
};

export const scottishTenureLabels: Record<Tenure, string> = {
  freehold: "Outright or absolute ownership",
  outright_or_absolute_ownership: "Outright or absolute ownership",
  leasehold: "Leasehold"
};

export const epcLabels: Record<EpcRating, string> = {
  unknown: "Unknown",
  A: "A",
  B: "B",
  C: "C",
  D: "D",
  E: "E",
  F: "F",
  G: "G",
  exempt: "Exempt"
};

export const selfEmploymentLabels: Record<SelfEmploymentType, string> = {
  sole_trader: "Sole trader",
  limited_company: "Limited company",
  partnership: "Partnership",
  llp: "LLP"
};

export const sharedOwnershipSchemeLabels: Record<SharedOwnershipScheme, string> = {
  shared_ownership: "Shared ownership",
  shared_equity: "Shared equity"
};

export const otherIncomeLabels: Record<HalifaxOtherIncomeType, string> = {
  additional_duty_hours: "Additional duty hours",
  attendance_allowance: "Attendance allowance",
  carers_allowance: "Carer's allowance",
  child_benefit: "Child benefit",
  child_tax_credit: "Child tax credit",
  colleague_flexible_benefit: "Colleague flexible benefit",
  constant_attendance_allowance: "Constant attendance allowance",
  disability_living_allowance: "Disability Living Allowance",
  employment_support_allowance: "Employment & Support Allowance",
  flight_pay_allowance: "Flight pay/Allowance",
  income_support: "Income support",
  industrial_injuries_disablement_benefit: "Industrial injuries disablement benefit",
  investment_income: "Investment income",
  maintenance: "Maintenance",
  mortgage_subsidy: "Mortgage subsidy",
  nursing_bank: "Nursing bank",
  personal_independence_payment: "Personal independence payment",
  rental_income_btl: "Rental income (from Buy to Let properties owned)",
  shift_allowance: "Shift allowance",
  town_area_or_car_allowance: "Town, area, or car allowance",
  trust_income: "Trust income",
  universal_credit: "Universal Credit",
  widowed_parents_allowance: "Widowed parents' allowance",
  working_tax_credit: "Working tax credit"
};

export function dependantOption(count: number): "0" | "1" | "2" | "3+" {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count === 2) return "2";
  return "3+";
}
