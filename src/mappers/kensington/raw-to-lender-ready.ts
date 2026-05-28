import type { LenderReadyInput } from "../../domain/contracts.js";
import { mapSkiptonRawInput } from "../skipton/raw-to-lender-ready.js";

type RawRecord = Record<string, unknown>;

interface MappingIssue {
  field: string;
  message: string;
}

export interface KensingtonRawMappingResult {
  input: LenderReadyInput;
  issues: MappingIssue[];
}

export function mapKensingtonRawInput(raw: RawRecord): KensingtonRawMappingResult {
  const base = mapSkiptonRawInput(raw);
  const issues = base.issues
    .filter((issue) => issue.field !== "property.postcode")
    .map(toKensingtonIssue);
  const journey = withInitialPeriodHint(base.input.case.journey, raw);
  const input: LenderReadyInput = {
    ...base.input,
    lender: "kensington",
    case: {
      ...base.input.case,
      journey
    }
  };

  if (!propertyPostcode(raw)) {
    issues.push({
      field: "property.postcode",
      message: "Property postcode was not present; Kensington adapter uses a default regional postcode based on the Scotland flag."
    });
  }

  if (!hasValue(raw.var_length_of_intro_period)) {
    issues.push({
      field: "case.journey",
      message: "Initial rate period was not present; Kensington product selection defaults to a 5 year product."
    });
  }

  if (input.case.sharedOwnershipScheme === "shared_equity") {
    issues.push({
      field: "case.sharedOwnershipScheme",
      message: "Kensington workbook maps Help to Buy/shared equity to a dedicated product range, but the current Kensington adapter only switches the shared ownership/equity path and product selection by LTV/initial period."
    });
  }

  return { input, issues: dedupeIssues(issues) };
}

function withInitialPeriodHint(journey: string, raw: RawRecord): string {
  const initialPeriod = normalized(raw.var_length_of_intro_period ?? raw.var_initial_period ?? raw.var_fixed_rate_period);
  if (/2|two/.test(initialPeriod) && !/2\s*(?:yr|year)|two/i.test(journey)) return `${journey} 2yr`;
  if (/5|five/.test(initialPeriod) && !/5\s*(?:yr|year)|five/i.test(journey)) return `${journey} 5yr`;
  return journey;
}

function toKensingtonIssue(issue: MappingIssue): MappingIssue {
  return {
    field: issue.field,
    message: issue.message
      .replace(/Skipton/g, "Kensington")
      .replace(
        "Kensington workbook includes Help to Buy/shared equity loan balance, but the current Kensington adapter only submits the shared-ownership rent expenditure field.",
        "Kensington workbook includes Help to Buy/shared equity loan balance; the current Kensington adapter keeps the lender-ready shared equity metadata and selects the available Kensington product by LTV and initial period."
      )
  };
}

function dedupeIssues(issues: MappingIssue[]): MappingIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.field}\0${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function propertyPostcode(raw: RawRecord): string {
  const propertyAddress = raw.var_property_details_address as RawRecord | undefined;
  return propertyAddress && typeof propertyAddress === "object" ? rawString(propertyAddress.postcode) : "";
}

function hasValue(value: unknown): boolean {
  return value != null && rawString(value) !== "";
}

function rawString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function normalized(value: unknown): string {
  return rawString(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
