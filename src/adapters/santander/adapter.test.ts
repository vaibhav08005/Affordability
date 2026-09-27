import assert from "node:assert/strict";
import test from "node:test";
import type { LenderReadyInput } from "../../domain/contracts.js";
import { santanderCurrentBalance } from "./adapter.js";

const baseInput: LenderReadyInput = {
  lender: "santander",
  case: {
    journey: "hm",
    applicationType: "single",
    numberOfApplicants: 1,
    mortgagePurpose: "purchase",
    customerType: "home_mover",
    repaymentType: "part_and_part",
    termYears: 25,
    sharedOwnershipOrEquity: false,
    hasInterestOnly: true,
    interestOnlyLoanAmount: 110000
  },
  property: {
    isInScotland: false,
    tenure: "freehold",
    epcRating: "unknown"
  },
  loan: {
    propertyValue: 560000,
    loanAmount: 405000
  },
  household: {
    dependants: []
  },
  applicants: [
    {
      index: 1,
      age: 41,
      employment: {
        type: "self_employed"
      },
      otherIncome: []
    }
  ],
  outgoings: {
    monthlyLoanRepayments: 0,
    creditCardBalances: 0,
    overdraftBalances: 0,
    otherMonthlyOutgoings: 0,
    monthlyBuyToLetPayments: 0,
    otherMortgageCommitments: []
  },
  otherProperties: []
};

test("Santander purchase details do not seed remortgage current balance", () => {
  assert.equal(santanderCurrentBalance(baseInput), 0);
});

test("Santander remortgage details preserve current balance fallback", () => {
  assert.equal(
    santanderCurrentBalance({
      ...baseInput,
      case: {
        ...baseInput.case,
        mortgagePurpose: "remortgage_no_additional_borrowing"
      }
    }),
    405000
  );
});
