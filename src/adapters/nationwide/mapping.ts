import type {
  CustomerType,
  EmploymentType,
  MortgagePurpose,
  RepaymentType,
  SelfEmploymentType,
  SharedOwnershipScheme,
  Tenure
} from "../../domain/contracts.js";

export const NATIONWIDE_CALCULATOR_URL =
  "https://www.nationwide-intermediary.co.uk/calculators/affordability-calculator";

export const NATIONWIDE_CALCULATOR_JSON_URL =
  "https://www.nationwide-intermediary.co.uk/-/media/files/aff_calc_april_2026.json?rev=672447ae0d76497c9b8f7e516ba56cd0";

export const applicationTypeValues: Record<MortgagePurpose, string> = {
  purchase: "0",
  remortgage_no_additional_borrowing: "1",
  remortgage_capital_raising: "1",
  further_advance: "2"
};

export const repaymentMethodValues: Record<RepaymentType, string> = {
  capital_and_interest: "1",
  interest_only: "2",
  part_and_part: "3"
};

export const ownershipTypeValues: Record<SharedOwnershipScheme | "standard" | "right_to_buy", string> = {
  standard: "SD",
  shared_equity: "ES",
  right_to_buy: "RB",
  shared_ownership: "SO"
};

export const tenureValues: Record<Tenure, string> = {
  freehold: "0",
  leasehold: "1",
  outright_or_absolute_ownership: "5"
};

export const propertyTypeValues = {
  detached_house: "1",
  semi_detached_house: "2",
  terraced_house: "3",
  detached_bungalow: "11",
  semi_detached_bungalow: "12",
  terraced_bungalow: "13",
  purpose_built_flat: "31",
  converted_flat: "32"
} as const;

export const regionValues = {
  north: "North",
  yorkshire_or_humberside: "YorkshireOrHumberside",
  north_west: "NorthWest",
  east_midlands: "EastMidlands",
  west_midlands: "WestMidlands",
  east_anglia: "EastAnglia",
  outer_south_east: "OuterSouthEast",
  outer_metropolitan: "OuterMetropolitan",
  greater_london: "GreaterLondon",
  south_west: "SouthWest",
  wales: "Wales",
  scotland: "Scotland",
  northern_ireland: "NorthernIreland",
  not_known: "NotKnown"
} as const;

export const customerTypeValues: Record<CustomerType | "existing_nationwide_borrower" | "borrower_with_another_lender", string> = {
  first_time_buyer: "1",
  existing_nationwide_borrower: "2",
  borrower_with_another_lender: "3",
  home_mover: "3"
};

export const employmentCategoryValues: Record<EmploymentType, string> = {
  employed: "E",
  self_employed: "T",
  pension: "R",
  other: "U"
};

export const selfEmploymentCategoryValues: Record<SelfEmploymentType, string> = {
  sole_trader: "T",
  partnership: "P",
  limited_company: "Y",
  llp: "P"
};

export const contractTypeValues = {
  permanent: "PM",
  fixed_term: "FC",
  subcontractor_fixed: "SF",
  subcontractor_open: "SE",
  temporary: "TP"
} as const;

export const incomeFrequencyValues = {
  annually: "1",
  quarterly: "2",
  monthly: "3",
  four_weekly: "4",
  weekly: "5"
} as const;
