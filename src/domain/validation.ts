import { z } from "zod";
import type { LenderReadyInput } from "./contracts.js";

const money = z.number().finite().nonnegative();
const positiveInteger = z.number().int().positive();
const halifaxOtherIncomeType = z.enum([
  "additional_duty_hours",
  "attendance_allowance",
  "carers_allowance",
  "child_benefit",
  "child_tax_credit",
  "colleague_flexible_benefit",
  "constant_attendance_allowance",
  "disability_living_allowance",
  "employment_support_allowance",
  "flight_pay_allowance",
  "income_support",
  "industrial_injuries_disablement_benefit",
  "investment_income",
  "maintenance",
  "mortgage_subsidy",
  "nursing_bank",
  "personal_independence_payment",
  "rental_income_btl",
  "shift_allowance",
  "town_area_or_car_allowance",
  "trust_income",
  "universal_credit",
  "widowed_parents_allowance",
  "working_tax_credit"
]);

const applicantSchema = z.object({
  index: z.union([z.literal(1), z.literal(2)]),
  dateOfBirth: z.string().optional(),
  age: z.number().int().min(18).max(100),
  retirementAge: z.number().int().min(50).max(100).optional(),
  employment: z.object({
    type: z.enum(["employed", "self_employed", "pension", "other"]),
    isContractor: z.boolean().optional(),
    businessType: z.enum(["sole_trader", "limited_company", "partnership", "llp"]).optional(),
    netProfitCurrentYear: money.optional(),
    netProfitPreviousYear: money.optional(),
    annualGrossIncome: money.optional(),
    annualOvertime: money.optional(),
    annualBonus: money.optional(),
    annualCommission: money.optional(),
    annualPensionIncome: money.optional(),
    otherAnnualPensionIncome: money.optional()
  }),
  otherIncome: z.array(z.object({
    type: halifaxOtherIncomeType,
    annualAmount: money
  }))
});

export const lenderReadyInputSchema = z.object({
  lender: z.enum(["halifax", "barclays", "natwest", "hsbc", "santander", "nationwide", "skipton", "virgin_money", "kensington"]),
  case: z.object({
    journey: z.string().min(1),
    applicationType: z.enum(["single", "joint"]),
    numberOfApplicants: z.union([z.literal(1), z.literal(2)]),
    mortgagePurpose: z.enum([
      "purchase",
      "remortgage_no_additional_borrowing",
      "remortgage_capital_raising",
      "further_advance"
    ]),
    customerType: z.enum(["first_time_buyer", "home_mover"]),
    repaymentType: z.enum(["capital_and_interest", "interest_only", "part_and_part"]),
    termYears: positiveInteger.max(40),
    sharedOwnershipOrEquity: z.boolean(),
    sharedOwnershipScheme: z.enum(["shared_ownership", "shared_equity"]).optional(),
    monthlySharedOwnershipRent: money.optional(),
    hasInterestOnly: z.boolean(),
    interestOnlyLoanAmount: money.optional(),
    monthlyRepaymentPlanPremium: money.optional()
  }),
  property: z.object({
    isInScotland: z.boolean(),
    tenure: z.enum(["freehold", "leasehold", "outright_or_absolute_ownership"]),
    epcRating: z.enum(["unknown", "A", "B", "C", "D", "E", "F", "G", "exempt"])
  }),
  loan: z.object({
    propertyValue: money,
    loanAmount: money,
    currentBalance: money.optional(),
    monthlyRepayment: money.optional(),
    currentLender: z.string().optional()
  }),
  household: z.object({
    dependants: z.array(z.object({
      age: z.number().int().min(0).max(100),
      relationship: z.string().optional()
    }))
  }),
  applicants: z.array(applicantSchema).min(1).max(2),
  outgoings: z.object({
    monthlyLoanRepayments: money,
    creditCardBalances: money,
    overdraftBalances: money,
    otherMonthlyOutgoings: money,
    monthlyBuyToLetPayments: money,
    otherMortgageCommitments: z.array(z.object({
      outstandingBalance: money,
      remainingTermYears: positiveInteger
    })).default([])
  }),
  otherProperties: z.array(z.object({
    isRental: z.boolean(),
    propertyValue: money,
    monthlyMortgagePayment: money,
    monthlyRent: money.optional(),
    currentBalance: money.optional(),
    interestOnlyBalance: money.optional(),
    remainingTermYears: positiveInteger.optional(),
    repaymentType: z.enum(["capital_and_interest", "interest_only", "part_and_part"]).optional()
  }))
}).superRefine((input, ctx) => {
  if (input.case.numberOfApplicants !== input.applicants.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["applicants"],
      message: "Applicant count must match case.numberOfApplicants."
    });
  }

  for (const applicant of input.applicants) {
    if (applicant.employment.type === "self_employed" && !applicant.employment.businessType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["applicants", applicant.index - 1, "employment", "businessType"],
        message: "Self-employed applicants require employment.businessType."
      });
    }
  }
});

export function parseLenderReadyInput(value: unknown): LenderReadyInput {
  return lenderReadyInputSchema.parse(value);
}
