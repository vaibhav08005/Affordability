/* Browser-side field plans. No Playwright or server-side code runs on the user's PC. */
globalThis.AffordabilityFillPlan = (() => {
  "use strict";
  const field = (name, value, selectors = [], labels = [], required = false, index = 0) => ({ name, value: String(value ?? ""), selectors, labels, required, index, kind: "field" });
  const choice = (name, value, selectors = [], groups = [], required = false, index = 0) => ({ name, value: String(value ?? ""), selectors, groups, required, index, kind: "choice" });
  const product = (initialPeriod, ltvBucket) => ({ name: "Product", kind: "product", initialPeriod, ltvBucket, required: true });
  const step = (name, anchor, items, next = []) => ({ name, anchor, items, next });
  const money = (value) => String(Math.round(Number(value ?? 0)));
  const sumOtherIncome = (applicant) => (applicant?.otherIncome ?? []).reduce((sum, item) => sum + (item.annualAmount ?? 0), 0);
  const variableIncome = (applicant) => (applicant?.employment?.annualBonus ?? 0) + (applicant?.employment?.annualCommission ?? 0) + (applicant?.employment?.annualOvertime ?? 0);
  const pensionIncome = (applicant) => (applicant?.employment?.annualPensionIncome ?? 0) + (applicant?.employment?.otherAnnualPensionIncome ?? 0);
  const dob = (applicant) => {
    const raw = applicant.dateOfBirth || `01/01/${new Date().getFullYear() - applicant.age}`;
    const parts = raw.split(/[-/]/);
    return parts[0]?.length === 4 ? { day: parts[2], month: parts[1], year: parts[0], uk: `${parts[2]}/${parts[1]}/${parts[0]}` } : { day: parts[0], month: parts[1], year: parts[2], uk: raw };
  };

  function forLender(lender, input) {
    const c = input.case;
    const loan = input.loan;
    const out = input.outgoings;
    const applicants = input.applicants;
    const dependants = input.household.dependants.length;
    const joint = c.numberOfApplicants === 2;
    const purchase = c.mortgagePurpose === "purchase";
    const repayment = c.repaymentType === "interest_only" ? "Interest only" : c.repaymentType === "part_and_part" ? "Part and part" : "Repayment";

    if (lender === "halifax") {
      const items = [
        choice("Applicants", joint ? "2+" : "1", [], ["How many people are applying?"], true),
        choice("Dependants", dependants > 2 ? "3+" : String(dependants), [], ["How many child or adult dependants?"]),
        choice("Loan type", purchase ? "Purchase" : c.mortgagePurpose === "further_advance" ? "Further advance" : c.mortgagePurpose === "remortgage_capital_raising" ? "Remortgage with capital raising" : "Remortgage with no additional borrowing", [], ["Loan type"]),
        choice("Customer type", c.customerType === "first_time_buyer" ? "First-time buyer" : "Home mover", [], ["Who is the customer?"]),
        field("Property value", money(loan.propertyValue), [], ["Property purchase price", "Property value"], true),
        field("Loan amount", money(loan.loanAmount), [], ["Loan amount", "Further advance amount"], true),
        field("Term", c.termYears, [], ["Loan term (years)", "Further advance loan term (years)"], true),
        choice("Shared ownership", c.sharedOwnershipOrEquity ? "Yes" : "No", [], ["Is the mortgage part of a shared ownership / shared equity scheme?"]),
        choice("Interest only", c.hasInterestOnly ? "Yes" : "No", [], ["Is any of the loan interest-only?", "Is any of the further advance interest-only?"]),
        choice("Scotland", input.property.isInScotland ? "Yes" : "No", [], ["Is the property in Scotland?"]),
        choice("Property tenure", input.property.isInScotland && input.property.tenure === "freehold" ? "Outright or absolute ownership" : input.property.tenure === "freehold" ? "Freehold" : input.property.tenure === "leasehold" ? "Leasehold" : "Outright or absolute ownership", [], ["Property type"]),
        field("EPC rating", input.property.epcRating === "unknown" ? "Unknown" : input.property.epcRating, [], ["Property EPC rating, if known"]),
        field("Monthly loans", money(out.monthlyLoanRepayments), [], ["Monthly loan repayments"]),
        field("Credit card balances", money(out.creditCardBalances), [], ["Total outstanding credit card balances"]),
        field("Overdraft balances", money(out.overdraftBalances), [], ["Total outstanding overdraft balances"]),
        field("Other outgoings", money(out.otherMonthlyOutgoings), [], ["Total amount of other monthly outgoings"]),
        field("Buy to let payments", money(out.monthlyBuyToLetPayments), [], ["Monthly Buy to Let mortgage payments"])
      ];
      if (c.sharedOwnershipOrEquity) {
        items.push(choice("Shared ownership scheme", c.sharedOwnershipScheme === "shared_equity" ? "Shared equity" : "Shared ownership", [], ["Scheme type"]));
        items.push(field("Shared ownership rent", money(c.monthlySharedOwnershipRent ?? 0), [], ["Monthly rent payable"]));
      }
      if (c.hasInterestOnly) {
        items.push(field("Interest only amount", money(c.interestOnlyLoanAmount ?? 0), [], ["Interest-only loan amount"]));
        items.push(field("Repayment plan premium", money(c.monthlyRepaymentPlanPremium ?? 0), [], ["Monthly premium for repayment plans"]));
      }
      for (const applicant of applicants) {
        items.push(field(`Applicant ${applicant.index} age`, applicant.age, applicant.index === 1 ? ["#age-one"] : ["#age-two"], [`Applicant ${applicant.index} age`, "Applicant age"], true));
        if (applicant.employment.type === "employed") items.push(choice(`Applicant ${applicant.index} employed income`, "Income from employer(s)", [], [], true, applicant.index - 1));
        if (applicant.employment.type === "self_employed") {
          items.push(choice(`Applicant ${applicant.index} self employed income`, "Self employed", [], [], true, applicant.index - 1));
          items.push(choice(`Applicant ${applicant.index} business type`, applicant.employment.businessType === "limited_company" ? "Limited company" : applicant.employment.businessType === "partnership" ? "Partnership" : applicant.employment.businessType === "llp" ? "LLP" : "Sole trader", [], ["Self employment type"]));
          items.push(field(`Applicant ${applicant.index} current profit`, money(applicant.employment.netProfitCurrentYear ?? 0), [], ["Net profit (current year)", "Share of net profit (current year)"], true, applicant.index - 1));
          items.push(field(`Applicant ${applicant.index} previous profit`, money(applicant.employment.netProfitPreviousYear ?? 0), [], ["Net profit (previous year)", "Share of net profit (previous year)"], true, applicant.index - 1));
        }
        if (applicant.employment.type === "pension") items.push(choice(`Applicant ${applicant.index} pension income`, "Pension", [], [], true, applicant.index - 1));
        items.push(field(`Applicant ${applicant.index} salary`, money(applicant.employment.annualGrossIncome ?? 0), [], [`Applicant ${applicant.index} gross annual basic salary`, "Gross annual basic salary"], applicant.employment.type === "employed", applicant.index - 1));
        items.push(field(`Applicant ${applicant.index} overtime`, money(applicant.employment.annualOvertime ?? 0), [], ["Annual overtime"], false, applicant.index - 1));
        items.push(field(`Applicant ${applicant.index} bonus`, money(applicant.employment.annualBonus ?? 0), [], ["Annual bonus payments"], false, applicant.index - 1));
        items.push(field(`Applicant ${applicant.index} commission`, money(applicant.employment.annualCommission ?? 0), [], ["Annual commission"], false, applicant.index - 1));
        items.push(field(`Applicant ${applicant.index} pension`, money(pensionIncome(applicant)), [], ["Taxable annual pension income"], false, applicant.index - 1));
        if (applicant.otherIncome.length) {
          items.push(choice(`Applicant ${applicant.index} other income`, "Other income", [], [], true, applicant.index - 1));
          items.push(field(`Applicant ${applicant.index} other annual amount`, money(sumOtherIncome(applicant)), [], ["Total annual amount"], true, applicant.index - 1));
        }
      }
      const otherCommitments = out.otherMortgageCommitments ?? [];
      items.push(choice("Other properties", input.otherProperties.length || otherCommitments.length ? "Yes" : "No", [], ["Do the applicants have any other properties owned other than Buy to Lets?"]));
      otherCommitments.forEach((commitment, i) => {
        items.push(field(`Other mortgage ${i + 1} balance`, money(commitment.outstandingBalance), [], ["Outstanding balance"], true, i));
        items.push(field(`Other mortgage ${i + 1} term`, commitment.remainingTermYears, [], ["Remaining term (years)"], true, i));
      });
      return [step("Affordability", { labels: ["Property purchase price", "Property value"], selectors: ["#age-one"] }, items)];
    }

    if (lender === "barclays") {
      const mortgage = [
        field("Property value", money(loan.propertyValue), [], ["Estimated property price or value (optional)"], true),
        field("Mortgage amount", money(loan.loanAmount), [], ["Total mortgage amount (optional)"], true),
        field("Term years", c.termYears, [], ["Years"], true),
        field("Term months", 0, [], ["Months"]),
        choice("Scotland", input.property.isInScotland ? "Yes" : "No", [], ["Is this property in Scotland?"]),
        choice("Repayment", repayment, [], ["Select a repayment method"])
      ];
      const income = [
        choice("Application", joint ? "Joint" : "Single", [], ["Application type"]),
        field("Dependants", dependants, [], ["Number of financial dependants (if applicable)"]),
        field("Credit balances", money(out.creditCardBalances + out.overdraftBalances), [], ["Total outstanding credit card, store card and overdraft balances (if applicable)"]),
        field("Monthly commitments", money(out.otherMonthlyOutgoings + out.monthlyLoanRepayments), [], ["Any other monthly financial commitments including council tax (if applicable)"])
      ];
      for (const applicant of applicants) {
        income.push(field(`Applicant ${applicant.index} salary`, money(applicant.employment.annualGrossIncome ?? 0), [], ["Annual gross income and taxable allowance", "Annual income before tax", "Annual basic salary"], applicant.employment.type === "employed", applicant.index - 1));
        income.push(field(`Applicant ${applicant.index} pension`, money(pensionIncome(applicant)), [], ["Annual pension income (if applicable)"], false, applicant.index - 1));
        income.push(field(`Applicant ${applicant.index} other income`, money(sumOtherIncome(applicant)), [], ["Any other annual income (if applicable)"], false, applicant.index - 1));
      }
      return [
        step("Mortgage requirements", { labels: ["Estimated property price or value (optional)"] }, mortgage, ["Next"]),
        step("Income and commitments", { labels: ["Number of financial dependants (if applicable)"] }, income, ["Next"]),
        step("Other mortgages", { text: ["other mortgages", "other properties"] }, [], [])
      ];
    }

    if (lender === "hsbc") {
      const hsbcIds = (prefix, index, suffix) => [`[id="${prefix}.${index}${suffix}"]`, `[id="${prefix}[${index}]${suffix}"]`];
      const first = [
        choice("Application type", purchase ? c.customerType === "first_time_buyer" ? "Buying first home" : "Home mover / Buy new property" : "Remortgage an existing property", [purchase ? c.customerType === "first_time_buyer" ? "#applicationType-FTB-radio-item" : "#applicationType-MOVER-radio-item" : "#applicationType-REPFOB-radio-item"], ["Application type"], true),
        choice("Applicants", joint ? "Joint" : "Sole", [joint ? "#applicantType-2-radio-item" : "#applicantType-1-radio-item"], ["Sole/Joint"], true),
        choice("Premier", "No", ["#isPremierAccount-no-radio-item"], ["Premier account"])
      ];
      const people = [];
      for (const applicant of applicants) {
        const i = applicant.index - 1;
        const date = dob(applicant);
        people.push(field(`Applicant ${applicant.index} birth day`, date.day, hsbcIds("dateOfBirth", i, ".dob-date-day-field"), ["Day"], true));
        people.push(field(`Applicant ${applicant.index} birth month`, date.month, hsbcIds("dateOfBirth", i, ".dob-date-month-field"), ["Month"], true));
        people.push(field(`Applicant ${applicant.index} birth year`, date.year, hsbcIds("dateOfBirth", i, ".dob-date-year-field"), ["Year"], true));
        people.push(field(`Applicant ${applicant.index} retirement age`, applicant.retirementAge ?? 70, hsbcIds("dateOfBirth", i, ".retirementAge-field")));
        const employment = applicant.employment.isContractor ? "Employed full time" : applicant.employment.type === "self_employed" ? applicant.employment.businessType === "limited_company" ? "Self-employed - Ltd Company Director/Shareholder" : "Self-employed - Sole Trader/Partnership" : applicant.employment.type === "pension" ? "Receiving pension/disability" : applicant.employment.type === "other" ? "Unemployed" : "Employed full time";
        people.push(field(`Applicant ${applicant.index} employment`, employment, hsbcIds("income", i, ".employementStatus-field"), ["Employment status"], true));
      }
      people.push(field("Dependent children", input.household.dependants.filter((d) => d.age < 18).length, ["#dependentDetailsChildren-field"], ["Total dependent children"]));
      people.push(field("Dependent adults", input.household.dependants.filter((d) => d.age >= 18).length, ["#dependentDetailsAdult-field"], ["Total dependent adults"]));
      const mortgage = [
        field("Property value", money(loan.propertyValue), ["#purchasePriceAmount-field"], ["Property value", "Purchase price", "Estimated property value"], true),
        field("Loan amount", money(loan.loanAmount), [], ["Mortgage amount", "Loan amount", "Amount to borrow"], true),
        field("Property postcode", "SW1A 1AA", ["#addressPostalCode-field"], ["Property postcode", "Postcode"]),
        choice("Interest only basis", c.hasInterestOnly || c.repaymentType !== "capital_and_interest" ? "Yes" : "No", [c.hasInterestOnly || c.repaymentType !== "capital_and_interest" ? "#repaymentTypeCode-yes-radio-item" : "#repaymentTypeCode-no-radio-item"]),
        field("Term", Math.min(c.termYears, 25), ["[id=\"yearsAndMonths.years-field\"]"], ["Mortgage term", "Term years", "Years"], true),
        field("Term months", 0, ["[id=\"yearsAndMonths.months-field\"]"])
      ];
      const income = applicants.flatMap((applicant) => {
        const i = applicant.index - 1;
        return [
          field(`Applicant ${applicant.index} salary`, money(applicant.employment.annualGrossIncome ?? 0), hsbcIds("income", i, ".incomeFields.grossAnnualIncome-field"), ["Gross annual income", "Annual basic salary"], applicant.employment.type === "employed"),
          field(`Applicant ${applicant.index} current profit`, money(applicant.employment.netProfitCurrentYear ?? 0), hsbcIds("income", i, ".incomeFields.latestYearprofit-field")),
          field(`Applicant ${applicant.index} previous profit`, money(applicant.employment.netProfitPreviousYear ?? 0), hsbcIds("income", i, ".incomeFields.previousYearprofit-field")),
          field(`Applicant ${applicant.index} other income`, money(sumOtherIncome(applicant) + pensionIncome(applicant)), hsbcIds("income", i, ".incomeFields.otherTaxableIncome-field")),
          field(`Applicant ${applicant.index} variable income`, money(variableIncome(applicant)), hsbcIds("income", i, ".incomeFields.bonusCommissionOvertime-field"))
        ];
      });
      const expenses = [
        field("Loan payments", money(out.monthlyLoanRepayments), hsbcIds("expenditure", 0, ".monthlyPaymentAmount-field"), ["Total monthly loan payments", "Monthly loan payments"]),
        field("Credit cards", money(out.creditCardBalances + out.overdraftBalances), hsbcIds("expenditure", 0, ".balanceOutstandingAmount-field"), ["Total credit card balances", "Credit card balances"]),
        field("Travel", money(out.monthlyTravelCosts ?? 0), [], ["Travel costs"]),
        field("Childcare", money(out.monthlyChildcareAndEducation ?? 0), [], ["Childcare"])
      ];
      return [
        step("Application", { selectors: ["#applicationType-FTB-radio-item", "#applicationType-MOVER-radio-item", "#applicationType-REPFOB-radio-item"], text: ["Application type"] }, first, ["Continue", "Next"]),
        step("Applicants", { selectors: hsbcIds("dateOfBirth", 0, ".dob-date-day-field"), text: ["Date of birth"] }, people, ["Continue", "Next"]),
        step("Mortgage", { labels: ["Mortgage amount", "Amount to borrow", "Property value"] }, mortgage, ["Continue", "Next"]),
        step("Income", { text: ["Your income", "Income details"] }, income, ["Continue", "Next"]),
        step("Expenditure", { labels: ["Total monthly loan payments", "Monthly loan payments"] }, expenses)
      ];
    }

    if (lender === "kensington") {
      const items = [
        choice("Mortgage type", purchase ? "Purchase" : "Remortgage", [], ["What type of mortgage will it be?"]),
        field("Product range", c.sharedOwnershipOrEquity ? "Residential Shared Ownership" : "Residential Select", ["#product"], [], true),
        product(/2\s*(?:yr|year)|two/i.test(c.journey) ? 2 : 5, [75, 80, 85, 90, 95].find((bucket) => loan.loanAmount / Math.max(loan.propertyValue, 1) * 100 <= bucket) ?? 95),
        field("Client name", "Kensington Test Client", ["#clientName"]),
        field("Term", c.termYears, ["#loan_term_requested"], [], true),
        field("Property value", money(loan.propertyValue), ["#property_valuation"], [], true),
        field("Loan amount", money(loan.loanAmount), ["#loan_amount"], [], true),
        field("Postcode", input.property.isInScotland ? "EH1 1AA" : "OX1 1AG", ["#postcode"]),
        choice("Applicants", joint ? "Joint Applicant" : "Single Applicant", [], ["Is this a single or joint application?"]),
        field("Shared ownership rent", money(c.monthlySharedOwnershipRent ?? 0), ["#shared_ownership_rent"]),
        field("Childcare", money(out.monthlyChildcareAndEducation ?? 0), ["#childcare"]),
        field("Maintenance", money(out.monthlyMaintenancePayments ?? 0), ["#maintenance"]),
        field("School fees", money(out.monthlySchoolFees ?? 0), ["#school_fees"]),
        field("Credit balances", money(out.creditCardBalances + out.overdraftBalances), ["#revolvingCreditBalance"])
      ];
      for (const applicant of applicants) {
        const i = applicant.index - 1;
        items.push(field(`Applicant ${applicant.index} postcode`, input.property.isInScotland ? "EH1 1AA" : "OX1 1AG", ["#post_code"], [], false, i));
        items.push(field(`Applicant ${applicant.index} date of birth`, dob(applicant).uk, ["#date_of_birth"], [], true, i));
        items.push(field(`Applicant ${applicant.index} retirement age`, applicant.retirementAge ?? 70, ["#planned_retirement_age"], [], false, i));
        items.push(field(`Applicant ${applicant.index} employment`, applicant.employment.isContractor ? "Contractor" : applicant.employment.type === "self_employed" ? "Self-Employed" : applicant.employment.type === "pension" ? "Retired" : applicant.employment.type === "other" ? "Not Employed" : "Employed", ['select[data-bind*="employment_status"]'], [], true, i));
        items.push(field(`Applicant ${applicant.index} salary`, money(applicant.employment.annualGrossIncome ?? 0), ['input[data-bind*="salary.formatted"]'], [], applicant.employment.type === "employed", i));
        items.push(field(`Applicant ${applicant.index} bonus`, money(applicant.employment.annualBonus ?? 0), ['input[data-bind*="bonus.formatted"]'], [], false, i));
        items.push(field(`Applicant ${applicant.index} commission`, money(applicant.employment.annualCommission ?? 0), ['input[data-bind*="commission.formatted"]'], [], false, i));
        items.push(field(`Applicant ${applicant.index} overtime`, money(applicant.employment.annualOvertime ?? 0), ['input[data-bind*="overtime.formatted"]'], [], false, i));
      }
      return [step("Residential calculator", { selectors: ["#clientName"] }, items)];
    }

    if (lender === "natwest") {
      const items = [
        choice("Applicants", joint ? "Joint" : "Sole", [joint ? "#basic-radio-2" : "#basic-radio-1"], ["Application type"], true),
        choice("Mortgage type", purchase ? "Purchase" : c.mortgagePurpose === "further_advance" ? "Additional borrowing" : c.mortgagePurpose === "remortgage_capital_raising" ? "Remortgage with additional borrowing" : "Remortgage", [], ["Mortgage purpose", "Type of mortgage"]),
        choice("Customer type", c.customerType === "first_time_buyer" ? "First time buyer" : "Home mover", [], ["Customer type"]),
        field("Repayment method", c.repaymentType === "capital_and_interest" ? "Capital and interest" : c.repaymentType === "interest_only" ? "Interest only" : "Part and part", [], ["Repayment method", "Repayment type"]),
        choice("Scotland", input.property.isInScotland ? "Yes" : "No", [], ["Is the property in Scotland?", "Scotland"]),
        field("Property tenure", input.property.tenure === "leasehold" ? "Leasehold" : input.property.tenure === "freehold" ? "Freehold" : "Outright or absolute ownership", [], ["Property tenure", "Tenure"]),
        field("EPC rating", input.property.epcRating === "unknown" ? "Unknown" : input.property.epcRating, [], ["Property EPC rating", "EPC rating"]),
        field("Loan to value", Math.round(loan.loanAmount / Math.max(loan.propertyValue, 1) * 100), ["#loanToValue"], ["Loan to value"], true),
        field("Property value", money(loan.propertyValue), [], ["Property value", "Purchase price", "Property purchase price", "Estimated property value"]),
        field("Loan amount", money(loan.loanAmount), ["#capitalAndInterest"], ["Loan amount", "Mortgage amount", "Capital and Interest"], true),
        field("Term", c.termYears, ["#MortgageTermYears"], ["Mortgage term", "Term years", "Loan term"], true),
        field("Term months", 0, ["#MortgageTermMonths"]),
        field("Dependants", dependants, ["#noOfDependents"], ["Total number of dependants", "Number of dependants", "Financial dependants"]),
        field("Credit balances", money(out.creditCardBalances + out.overdraftBalances), ["#totalCreditCardBalance"], ["Credit card balances", "Total credit card balances"]),
        field("Monthly loans", money(out.monthlyLoanRepayments), ["#monthlyLoanPayments"], ["Monthly loan repayments", "Monthly loan payments"]),
        field("Other outgoings", money(out.otherMonthlyOutgoings), ["#otherCommitedExpenditure"], ["Other monthly outgoings", "Other committed expenditure"])
      ];
      if (c.hasInterestOnly) items.push(field("Interest only amount", money(c.interestOnlyLoanAmount ?? 0), [], ["Interest only amount", "Interest-only amount"]));
      for (const applicant of applicants) {
        items.push(field(`Applicant ${applicant.index} employment`, applicant.employment.type === "self_employed" ? "Self-employed" : applicant.employment.type === "pension" ? "Retired" : applicant.employment.type === "other" ? "Other" : "Employed", [], [`Applicant ${applicant.index} employment status`, "Employment status"], false, applicant.index - 1));
        items.push(field(`Applicant ${applicant.index} salary`, money(applicant.employment.annualGrossIncome ?? 0), [applicant.index === 1 ? "#applicantOneMainIncome" : "#applicantTwoMainIncome"], [`Applicant ${applicant.index} main income annual gross`, "Annual basic income", "Gross annual income"], applicant.employment.type === "employed"));
        items.push(field(`Applicant ${applicant.index} bonus`, money(applicant.employment.annualBonus ?? 0), [], [`Applicant ${applicant.index} gross annual discretionary bonus paid half yearly or annually`, "Annual bonus"], false, applicant.index - 1));
        items.push(field(`Applicant ${applicant.index} current profit`, money(applicant.employment.netProfitCurrentYear ?? 0), [], ["Latest year", "Current year", "Net profit current year"], false, applicant.index - 1));
        items.push(field(`Applicant ${applicant.index} previous profit`, money(applicant.employment.netProfitPreviousYear ?? 0), [], ["Previous year", "Net profit previous year"], false, applicant.index - 1));
        items.push(field(`Applicant ${applicant.index} pension`, money(pensionIncome(applicant)), [], ["Other annual pension income", "Other pension income"], false, applicant.index - 1));
      }
      items.push(choice("Other mortgages", input.otherProperties.length || out.otherMortgageCommitments.length ? "Yes" : "No", [], ["Other mortgages", "Existing mortgages", "Other properties"]));
      items.push(field("Other mortgage payments", money(input.otherProperties.reduce((sum, property) => sum + property.monthlyMortgagePayment, 0)), [], ["Other mortgage monthly payments", "Total monthly payments for other mortgages"]));
      return [step("Residential affordability", { selectors: ["#loanToValue", "#capitalAndInterest"] }, items)];
    }

    if (lender === "nationwide") {
      const mortgage = [
        choice("Mortgage purpose", purchase ? "Buy a new property" : c.mortgagePurpose === "further_advance" ? "Borrow more" : "Remortgage existing property", [`#AffCalc-q10-ApplicationType-${purchase ? 0 : c.mortgagePurpose === "further_advance" ? 2 : 1}`], [], true),
        choice("Repayment method", c.repaymentType === "capital_and_interest" ? "Repayment" : c.repaymentType === "interest_only" ? "Interest Only" : "Part and Part", [`#AffCalc-q2-RepaymentMethod-${c.repaymentType === "capital_and_interest" ? 0 : c.repaymentType === "interest_only" ? 1 : 2}`], [], true),
        choice("Applicants", String(c.numberOfApplicants), [`#AffCalc-q0-NumberOfApplicants-${c.numberOfApplicants - 1}`], [], true),
        choice("Scotland", input.property.isInScotland ? "Yes" : "No", [input.property.isInScotland ? "#AffCalc-q135-Region-0" : "#AffCalc-q135-Region-1"]),
        choice("Found a home", "Yes", [], ["found a new home"]),
        field("Loan amount", money(loan.loanAmount), [], ["How much would your client(s) like to borrow?", "Borrowing amount"], true),
        field("Term years", c.termYears, [], ["How long does the mortgage term need to be? years", "Mortgage term years", "years"], true),
        field("Term months", 0, [], ["How long does the mortgage term need to be? months", "Mortgage term months", "months"]),
        field("Property value", money(loan.propertyValue), [], ["purchase price", "current estimated value", "full market value"], purchase),
        field("Ownership type", c.sharedOwnershipOrEquity ? c.sharedOwnershipScheme === "shared_equity" ? "ES" : "SO" : "SD", [], ["What type of ownership will it be?", "OwnershipType"]),
        field("Property tenure", input.property.tenure === "leasehold" ? "1" : input.property.tenure === "outright_or_absolute_ownership" ? "5" : "0", [], ["property's legal status", "PropertyTenure"]),
        field("Property type", "1", ["#AffCalc-q80-PropertyType"]),
        field("Region", input.property.isInScotland ? "Scotland" : "NotKnown", [], ["property based", "Region"])
      ];
      const clients = [];
      for (const applicant of applicants) {
        const prefix = applicant.index === 1 ? "AffCalc-q140" : "AffCalc-q190";
        const date = dob(applicant);
        clients.push(field(`Applicant ${applicant.index} birth day`, date.day, [`#${prefix}-Day`], ["DD"], true));
        clients.push(field(`Applicant ${applicant.index} birth month`, date.month, [`#${prefix}-Month`], ["MM"], true));
        clients.push(field(`Applicant ${applicant.index} birth year`, date.year, [`#${prefix}-Year`], ["YYYY"], true));
        clients.push(field(`Applicant ${applicant.index} status`, c.customerType === "first_time_buyer" ? "1" : "3", [applicant.index === 1 ? "#AffCalc-q145-PropertyTenure" : "#AffCalc-q195-JointApplicant-CustomerType"], [], true));
        clients.push(choice(`Applicant ${applicant.index} dependants`, dependants ? "Yes" : "No", [applicant.index === 1 ? `#AffCalc-q150-HaveDependents-${dependants ? 0 : 1}` : `#AffCalc-q200-HaveDependents-${dependants ? 0 : 1}`], [], true));
        if (dependants) {
          const bands = [
            input.household.dependants.filter((d) => d.age <= 5).length,
            input.household.dependants.filter((d) => d.age >= 6 && d.age <= 11).length,
            input.household.dependants.filter((d) => d.age >= 12 && d.age <= 17).length,
            input.household.dependants.filter((d) => d.age >= 18).length
          ];
          ["Age0to5", "Age6to11", "Age12to17", "Age18More"].forEach((band, i) => clients.push(field(`Applicant ${applicant.index} dependants ${band}`, bands[i], [`#AffCalc-q${applicant.index === 1 ? 160 : 210}-${band}-${i}`])));
        }
        clients.push(choice(`Applicant ${applicant.index} retired`, applicant.employment.type === "pension" ? "Yes" : "No", [applicant.index === 1 ? `#AffCalc-q170-IsCustomerRetired-${applicant.employment.type === "pension" ? 0 : 1}` : `#AffCalc-q220-IsCustomerRetired-${applicant.employment.type === "pension" ? 0 : 1}`], [], true));
        clients.push(field(`Applicant ${applicant.index} retirement age`, applicant.retirementAge ?? 70, [applicant.index === 1 ? "#AffCalc-q180-RetirementAge" : "#AffCalc-q230-RetirementAge"]));
      }
      const income = applicants.flatMap((applicant) => {
        const first = applicant.index === 1;
        const q = (one, two) => `#AffCalc-q${first ? one : two}`;
        const status = applicant.employment.type === "self_employed" && applicant.employment.businessType === "limited_company" ? "Y" :
          applicant.employment.type === "self_employed" && ["partnership", "llp"].includes(applicant.employment.businessType) ? "P" :
          applicant.employment.type === "self_employed" ? "T" : applicant.employment.type === "pension" ? "R" : applicant.employment.type === "other" ? "U" : "E";
        return [
          field(`Applicant ${applicant.index} employment`, status, [q("240-EmploymentCategory", "780-EmploymentCategory")], [], true),
          field(`Applicant ${applicant.index} contract type`, applicant.employment.isContractor ? "FC" : "PM", [q("250-EmploymentType", "790-EmploymentType")]),
          choice(`Applicant ${applicant.index} contractor tax status`, applicant.employment.isContractor ? "Yes" : "No", [q(`260-TreatedAsEmployedForTax-${applicant.employment.isContractor ? 0 : 1}`, `800-TreatedAsEmployedForTax-${applicant.employment.isContractor ? 0 : 1}`)]),
          field(`Applicant ${applicant.index} job years`, 2, [q("270-JobYears", "810-JobYears")]),
          field(`Applicant ${applicant.index} job months`, 0, [q("270-JobMonths", "810-JobMonths")]),
          field(`Applicant ${applicant.index} business years`, 2, [q("280-BusinessYears", "820-BusinessYears")]),
          field(`Applicant ${applicant.index} business months`, 0, [q("280-BusinessMonths", "820-BusinessMonths")]),
          field(`Applicant ${applicant.index} contract years`, 2, [q("300-ContractYears", "840-ContractYears")]),
          field(`Applicant ${applicant.index} contract months`, 0, [q("300-ContractMonths", "840-ContractMonths")]),
          field(`Applicant ${applicant.index} gross income`, money(applicant.employment.annualGrossIncome ?? 0), [q("320-GrossAnnualIncome", "860-GrossAnnualIncome")], ["Basic annual salary", "Annual gross income"], applicant.employment.type === "employed"),
          field(`Applicant ${applicant.index} bonus`, money(applicant.employment.annualBonus ?? 0), [q("330-Bonus", "870-Bonus")]),
          field(`Applicant ${applicant.index} overtime`, money(applicant.employment.annualOvertime ?? 0), [q("340-Overtime", "880-Overtime")]),
          field(`Applicant ${applicant.index} commission`, money(applicant.employment.annualCommission ?? 0), [q("350-Commission", "890-Commission")]),
          field(`Applicant ${applicant.index} current profit`, money(applicant.employment.netProfitCurrentYear ?? 0), [q("360-LatestPeriodProfit", "900-LatestPeriodProfit")]),
          field(`Applicant ${applicant.index} previous profit`, money(applicant.employment.netProfitPreviousYear ?? 0), [q("370-PreviousPeriodProfit", "910-PreviousPeriodProfit")]),
          choice(`Applicant ${applicant.index} second job`, "No", [q("420-HasSecondJob-1", "960-HasSecondJob-1")], [], true),
          choice(`Applicant ${applicant.index} other income`, applicant.otherIncome.length || pensionIncome(applicant) ? "Yes" : "No", [q(`610-HasOtherIncome-${applicant.otherIncome.length || pensionIncome(applicant) ? 0 : 1}`, `1150-HasOtherIncome-${applicant.otherIncome.length || pensionIncome(applicant) ? 0 : 1}`)], [], true)
        ];
      });
      const expenses = [
        field("Council tax", money(out.monthlyCouncilTax ?? 0), ["#AffCalc-q1620-CouncilTax"]),
        field("Building insurance", money(out.monthlyBuildingInsurance ?? 0), ["#AffCalc-q1630-BuildingInsurance"]),
        field("Service charge", money(out.monthlyServiceCharge ?? 0), ["#AffCalc-q1640-ServiceCharge"]),
        field("Ground rent", money(out.monthlyGroundRent ?? 0), ["#AffCalc-q1650-GroundRent"]),
        field("Shared ownership rent", money(c.monthlySharedOwnershipRent ?? 0), ["#AffCalc-q1660-SharedOwnershipRental"])
      ];
      return [
        step("Mortgage", { labels: ["How much would your client(s) like to borrow?", "Borrowing amount"] }, mortgage, ["Next", "Continue"]),
        step("About your client", { selectors: ["#AffCalc-q140-Day", "#AffCalc-q140-Year"], text: ["About your client"] }, clients, ["Next", "Continue"]),
        step("Income", { selectors: ["#AffCalc-q240-EmploymentCategory"] }, income, ["Next", "Continue"]),
        step("Outgoings", { selectors: ["#AffCalc-q1620-CouncilTax"], text: ["Outgoings"] }, expenses)
      ];
    }

    if (lender === "santander") {
      const mortgage = [
        choice("Application", joint ? "Joint" : "Single", [], [], true),
        choice("Mortgage purpose", purchase ? "Purchase" : "Remortgage", [], [], true),
        field("Dependants", dependants, ["#Dependants"], ["Number of financial dependants"]),
        field("Property value", money(loan.propertyValue), ["#PropertyValue"], ["Estimated property value"], true),
        field("Repayment method", c.repaymentType === "capital_and_interest" ? "Capital and interest" : c.repaymentType === "interest_only" ? "Interest only - sale of mortgaged property" : "Part and part - sale of mortgaged property", ["#RepaymentMethod"], ["Repayment method"], true),
        field("Capital and interest amount", money(c.repaymentType === "interest_only" ? 0 : loan.loanAmount - (c.interestOnlyLoanAmount ?? 0)), ["#CapitalAndInterestAmt"], ["Amount required on capital and interest"], true),
        field("Interest only amount", money(c.interestOnlyLoanAmount ?? 0), ["#InterestOnlyAmt"], ["Amount required on interest only"]),
        field("Term years", c.termYears, ["#TermYears"], [], true),
        field("Term months", 0, ["#TermMonths"]),
        field("Oldest applicant age", Math.max(...applicants.map((applicant) => applicant.age)) + 1, [], ["How old will the oldest applicant be on their next birthday"])
      ];
      const income = applicants.flatMap((applicant) => [
        field(`Applicant ${applicant.index} gross income`, money(applicant.employment.annualGrossIncome ?? 0), [], [`Applicant ${applicant.index} gross basic income`, "Gross basic income", "Gross annual income"], applicant.employment.type === "employed", applicant.index - 1),
        field(`Applicant ${applicant.index} pension`, money(pensionIncome(applicant)), [], ["Pension income"], false, applicant.index - 1),
        field(`Applicant ${applicant.index} other income`, money(sumOtherIncome(applicant)), [], ["Other income"], false, applicant.index - 1)
      ]);
      const expenses = [
        field("Credit balances", money(out.creditCardBalances), [], ["Credit card balances", "Credit balances"]),
        field("Monthly loans", money(out.monthlyLoanRepayments), [], ["Monthly loan repayments", "Loan repayments"]),
        field("Childcare", money(out.monthlyChildcareAndEducation ?? 0), [], ["Childcare", "Education"])
      ];
      return [
        step("Mortgage details", { selectors: ["#PropertyValue", "#TermYears"] }, mortgage, ["Next", "Continue"]),
        step("Other properties", { text: ["Other properties"] }, [], ["Next", "Continue"]),
        step("Annual gross income", { text: ["Annual gross income"] }, income, ["Next", "Continue"]),
        step("Commitments and expenditure", { text: ["Commitments and expenditure"] }, expenses)
      ];
    }

    if (lender === "skipton") {
      const first = [
        choice("Applicants", String(c.numberOfApplicants), [`#MainContent_rblNumberOfApplicants_${c.numberOfApplicants - 1}`], [], true),
        field("Adult dependants", input.household.dependants.filter((d) => d.age >= 18).length, ["#MainContent_txtNoOfAdultDependants"]),
        field("Child dependants", input.household.dependants.filter((d) => d.age < 18).length, ["#MainContent_txtNoOfChildDependants"]),
        field("Property value", money(loan.propertyValue), ["#MainContent_txtPurchasePrice"], [], true),
        field("Loan amount", money(loan.loanAmount), ["#MainContent_txtLoanAmount"], [], true),
        field("Term years", c.termYears, ["#MainContent_txtTermYears"], [], true),
        field("Term months", 0, ["#MainContent_txtTermMonths"]),
        field("Product interest rate", "5.2", ["#MainContent_txtProductInterestRate"]),
        choice("Repayment type", c.repaymentType, [`#MainContent_rblRepaymentType_${c.repaymentType === "interest_only" ? 1 : c.repaymentType === "part_and_part" ? 2 : 0}`]),
        field("Interest only amount", money(c.interestOnlyLoanAmount ?? 0), ["#MainContent_txtInterestOnlyAmount"]),
        field("Region", input.property.isInScotland ? "sc" : "se", ["#MainContent_ddlRegion"])
      ];
      const applicantDetails = applicants.flatMap((applicant) => {
        const i = applicant.index - 1;
        const employmentIndex = applicant.employment.isContractor ? 1 : applicant.employment.type === "self_employed" ? 3 : applicant.employment.type === "pension" ? 2 : applicant.employment.type === "other" ? 1 : 0;
        return [
          choice(`Applicant ${applicant.index} first time buyer`, c.customerType === "first_time_buyer" ? "Yes" : "No", [`#MainContent_rptApplicants_rblFirstTimeBuyer_${i}_${c.customerType === "first_time_buyer" ? 0 : 1}_${i}`]),
          choice(`Applicant ${applicant.index} employment`, applicant.employment.type, [`#MainContent_rptApplicants_rblEmploymentTypes_${i}_${employmentIndex}_${i}`], [], true)
        ];
      });
      const income = applicants.flatMap((applicant) => [
        field(`Applicant ${applicant.index} salary`, money(applicant.employment.annualGrossIncome ?? 0), [`#MainContent_txtIncome000001${applicant.index - 1}`], [], applicant.employment.type === "employed"),
        field(`Applicant ${applicant.index} pension`, money(pensionIncome(applicant)), [`#MainContent_txtIncome000012${applicant.index - 1}`]),
        field(`Applicant ${applicant.index} current profit`, money(applicant.employment.netProfitCurrentYear ?? 0), [`#MainContent_txtIncome000007${applicant.index - 1}`]),
        field(`Applicant ${applicant.index} variable income`, money(variableIncome(applicant)), [`#MainContent_txtIncome3${applicant.index - 1}`])
      ]);
      const expenses = [
        field("Credit card balances", money(out.creditCardBalances), ["#MainContent_txtExpenditure_000023_0"]),
        field("Monthly loans", money(out.monthlyLoanRepayments), ["#MainContent_txtExpenditure_000031_0"]),
        field("Childcare", money(out.monthlyChildcareAndEducation ?? 0), ["#MainContent_txtExpenditure_000005_0"]),
        field("Maintenance", money(out.monthlyMaintenancePayments ?? 0), ["#MainContent_txtExpenditure_000003_0"]),
        field("Shared ownership rent", money(c.monthlySharedOwnershipRent ?? 0), ["#MainContent_txtExpenditure_000037_0"])
      ];
      return [
        step("Application details", { selectors: ["#MainContent_txtPurchasePrice"] }, first, ["Next", "Continue"]),
        step("Applicant details", { selectors: ['[id^="MainContent_rptApplicants_rblEmploymentTypes_"]'] }, applicantDetails, ["Next", "Continue"]),
        step("Income", { selectors: ["#MainContent_txtIncome0000010", "#MainContent_txtIncome0000120"] }, income, ["Next", "Continue"]),
        step("Expenditure", { selectors: ["#MainContent_txtExpenditure_000023_0"] }, expenses)
      ];
    }

    if (lender === "virgin_money") {
      const mortgage = [
        choice("Loan type", purchase ? "purchase" : "remortgage", [purchase ? "#purchase" : "#remortgage"], [], true),
        choice("Shared ownership", c.sharedOwnershipOrEquity ? "Yes" : "No", [c.sharedOwnershipOrEquity ? "#hbs-yes-shared-ownership" : "#hbs-no-shared-ownership"]),
        choice("Repayment type", c.repaymentType === "capital_and_interest" ? "capital-and-interest" : c.repaymentType === "interest_only" ? "interest-only" : "part-and-part", [`#${c.repaymentType === "capital_and_interest" ? "capital-and-interest" : c.repaymentType === "interest_only" ? "interest-only" : "part-and-part"}`]),
        field("Term", c.termYears, ["#Form_LoanDetails_RepaymentTerm"], [], true),
        field("Property value", money(loan.propertyValue), [purchase ? "#Form_LoanDetails_PurchasePrice" : "#Form_LoanDetails_PropertyValue"], [], true),
        field(purchase ? "Loan amount" : "Current balance", money(purchase ? loan.loanAmount : loan.currentBalance ?? loan.loanAmount), [purchase ? "#Form_LoanDetails_MortgageLoanAmount" : "#Form_LoanDetails_CurrentMortgageBalance"], [], true),
        field("Additional borrowing", money(c.mortgagePurpose === "remortgage_no_additional_borrowing" ? 0 : Math.max(0, loan.loanAmount - (loan.currentBalance ?? 0))), ["#Form_LoanDetails_AdditionalBorrowingAmount"]),
        field("Interest only part", money(c.interestOnlyLoanAmount ?? 0), ["#Form_LoanDetails_IOLoanAmount"])
      ];
      const people = [
        choice("Applicants", joint ? "joint-application" : "single-application", [joint ? "#joint-application" : "#single-application"]),
        field("Dependants", Math.min(dependants, 9), ["#Form_FirstPersonalDetails_Dependants"]),
        choice("Region", input.property.isInScotland ? "Scotland" : "England", [input.property.isInScotland ? "#scotland-1-1" : "#england-1-1"])
      ];
      for (const applicant of applicants) {
        const prefix = applicant.index === 1 ? "FirstPersonalDetails" : "SecondPersonalDetails";
        people.push(field(`Applicant ${applicant.index} age`, applicant.age, [`#Form_${prefix}_Age`], [], true));
        people.push(field(`Applicant ${applicant.index} employment`, applicant.employment.isContractor ? "Contractor" : applicant.employment.type === "self_employed" ? "Self-employed" : applicant.employment.type === "pension" ? "Retired" : applicant.employment.type === "other" ? "Not Employed" : "Employed", [`#Form_${prefix}_Employment1_EmploymentStatus`], [], true));
        people.push(field(`Applicant ${applicant.index} salary`, money(applicant.employment.annualGrossIncome ?? 0), [`#Form_${prefix}_Employment1_EmployedGrossAnnualSalary`], [], applicant.employment.type === "employed"));
        people.push(field(`Applicant ${applicant.index} bonus`, money(variableIncome(applicant)), [`#Form_${prefix}_Employment1_OvertimeBonusCommission`]));
        people.push(field(`Applicant ${applicant.index} current profit`, money(applicant.employment.netProfitCurrentYear ?? 0), [`#Form_${prefix}_Employment1_MostRecentNetProfit`]));
        people.push(field(`Applicant ${applicant.index} previous profit`, money(applicant.employment.netProfitPreviousYear ?? 0), [`#Form_${prefix}_Employment1_PreviousYearNetProfit`]));
        people.push(field(`Applicant ${applicant.index} pension`, money(pensionIncome(applicant)), [`#Form_${prefix}_Employment1_GrossAnnualPensionIncome`]));
      }
      const expenses = [
        field("Ground rent", money(out.monthlyGroundRent ?? 0), ["#Form_Outgoings_MonthlyGroundRent"]),
        field("Service charge", money(out.monthlyServiceCharge ?? 0), ["#Form_Outgoings_MonthlyServiceCharge"]),
        field("Childcare", money(out.monthlyChildcareAndEducation ?? 0), ["#Form_Outgoings_MonthlyChildcareEducation"]),
        field("Credit", money(out.creditCardBalances), ["#Form_Outgoings_OutstandingCredit"]),
        field("Loans", money(out.monthlyLoanRepayments), ["#Form_Outgoings_CurrentLoanRepayments"]),
        field("Shared ownership rent", money(c.monthlySharedOwnershipRent ?? 0), ["#Form_Outgoings_MonthlySharedOwnershipRent"]),
        field("Maintenance", money(out.monthlyMaintenancePayments ?? 0), ["#Form_Outgoings_MonthlyMaintenanceCSA"]),
        field("Buy to let payments", money(out.monthlyBuyToLetPayments), ["#Form_Outgoings_OtherBuyToLetMortgagesMonthlyRepayment"])
      ];
      return [
        step("Loan details", { selectors: ["#Form_LoanDetails_RepaymentTerm"] }, mortgage, ["Continue", "Next"]),
        step("Personal details", { selectors: ["#Form_FirstPersonalDetails_Age"] }, people, ["Continue", "Next"]),
        step("Outgoings", { selectors: ["#Form_Outgoings_CurrentLoanRepayments"] }, expenses)
      ];
    }
    throw new Error(`No browser fill plan for ${lender}.`);
  }

  return { forLender };
})();
