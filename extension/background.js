"use strict";

const websiteOrigins = new Set([
  "https://mortgage-affordability-demo-476501925780.europe-west2.run.app",
  "http://localhost:3000", "http://localhost:3110",
  "http://127.0.0.1:3000", "http://127.0.0.1:3110"
]);
const lenderUrls = Object.freeze({
  barclays: "https://onlinemortgages.uk.barclays/secure/launch/residential-affordability-calculator",
  halifax: "https://www2.halifax-intermediariesonline.co.uk/tools/calculator/",
  hsbc: "https://www.hsbc.co.uk/services/global-mortgages/ntb/affordability-calculator/",
  kensington: "https://www.kensingtonmortgages.co.uk/archive/calculators/residential",
  natwest: "https://spa.mortgages.natwest.com/calculator/residential-affordability",
  nationwide: "https://www.nationwide-intermediary.co.uk/calculators/affordability-calculator",
  santander: "https://www.santanderforintermediaries.co.uk/calculators-and-forms/affordability",
  skipton: "https://affordability.skipton-intermediaries.co.uk/",
  virgin_money: "https://intermediaries.virginmoney.com/affordability-calculator/residential/loan-details/"
});
const lenderHosts = Object.fromEntries(Object.entries(lenderUrls).map(([lender, url]) => [lender, new URL(url).hostname]));
const jobKey = (tabId) => `calculatorJob:${tabId}`;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse, (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== "string" || !sender.tab?.id || !sender.url) throw new Error("Invalid extension request.");
  const senderUrl = new URL(sender.url);
  const tabId = sender.tab.id;
  if (message.type === "OPEN_CALCULATOR") {
    if (!websiteOrigins.has(senderUrl.origin)) throw new Error("Website is not approved for this extension.");
    const url = Object.hasOwn(lenderUrls, message.lender) ? lenderUrls[message.lender] : null;
    if (!url || message.input?.lender !== message.lender || !/^[a-z0-9-]{1,150}$/.test(message.caseId)) {
      throw new Error("Invalid lender case.");
    }
    if (!message.input?.case || !message.input?.loan || !Array.isArray(message.input?.applicants)) {
      throw new Error("Incomplete lender input.");
    }
    const tab = await chrome.tabs.create({ url: "about:blank", active: true, openerTabId: tabId });
    if (!tab.id) throw new Error("Chrome did not create a lender tab.");
    await chrome.storage.session.set({ [jobKey(tab.id)]: { caseId: message.caseId, lender: message.lender, input: message.input, createdAt: Date.now() } });
    try {
      await chrome.tabs.update(tab.id, { url });
    } catch (error) {
      await chrome.storage.session.remove(jobKey(tab.id));
      await chrome.tabs.remove(tab.id).catch(() => undefined);
      throw error;
    }
    return { ok: true };
  }
  const record = await chrome.storage.session.get(jobKey(tabId));
  const job = record[jobKey(tabId)];
  if (!job || Date.now() - job.createdAt > 5 * 60_000) {
    await chrome.storage.session.remove(jobKey(tabId));
    return { ok: false, error: "Calculator handoff expired. Click the website button again." };
  }
  if (senderUrl.protocol !== "https:" || senderUrl.hostname !== lenderHosts[job.lender]) {
    throw new Error("Calculator tab is on an unexpected website.");
  }
  if (message.type === "GET_CALCULATOR_JOB") return { ok: true, job };
  if (message.type === "PATCH_SANTANDER_DETAILS") {
    if (job.lender !== "santander") throw new Error("This patch is only for Santander.");
    const input = job.input;
    const details = {
      applicationType: input.case.numberOfApplicants === 1 ? "Single" : "Joint",
      dependants: input.household.dependants.length,
      mortgageType: input.case.mortgagePurpose === "purchase" ? "Purchase" : "Remortgage",
      propertyValue: Math.round(input.loan.propertyValue),
      currentBalance: Math.round(input.loan.currentBalance ?? input.loan.loanAmount),
      repaymentMethod: input.case.repaymentType === "capital_and_interest" ? "Capital and interest" :
        input.case.repaymentType === "interest_only" ? "Interest only - sale of mortgaged property" : "Part and part - sale of mortgaged property",
      interestOnlyAmt: Math.round(input.case.repaymentType === "capital_and_interest" ? 0 : input.case.interestOnlyLoanAmount ?? input.loan.loanAmount),
      capitalAndInterestAmt: Math.round(input.case.repaymentType === "interest_only" ? 0 : input.loan.loanAmount - (input.case.interestOnlyLoanAmount ?? 0)),
      oldestApplicantAge: Math.max(...input.applicants.map((applicant) => applicant.age)) + 1,
      totalMonths: input.case.termYears * 12,
      mortgageTerm: input.case.termYears * 12
    };
    const result = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: patchSantanderDetails, args: [details] });
    return { ok: result.some((entry) => entry.result === true) };
  }
  if (message.type === "CALCULATOR_DONE") {
    await chrome.storage.session.remove(jobKey(tabId));
    return { ok: true };
  }
  throw new Error("Unsupported extension request.");
}

async function patchSantanderDetails(values) {
  const app = document.querySelector("#AffordabilityCalculator");
  const context = app?.__vue_app__?._context;
  const pinia = Reflect.ownKeys(context?.provides ?? {})
    .map((key) => context?.provides?.[key])
    .find((candidate) => candidate && typeof candidate === "object" && candidate.state?.value?.details);
  const state = pinia?.state?.value?.details;
  if (!state) return false;
  state.applicationType = values.applicationType;
  state.dependants = values.dependants;
  state.mortgageType = values.mortgageType;
  await new Promise((resolve) => setTimeout(resolve, 250));
  Object.assign(state, values);
  state.existingMortgageBalance = values.currentBalance;
  return true;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(jobKey(tabId)).catch(() => undefined);
});
