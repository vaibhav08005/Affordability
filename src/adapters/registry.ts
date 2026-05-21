import { barclaysAdapter } from "./barclays/adapter.js";
import { halifaxAdapter } from "./halifax/adapter.js";
import { hsbcAdapter } from "./hsbc/adapter.js";
import { kensingtonAdapter } from "./kensington/adapter.js";
import { natwestAdapter } from "./natwest/adapter.js";
import { nationwideAdapter } from "./nationwide/adapter.js";
import { santanderAdapter } from "./santander/adapter.js";
import { skiptonAdapter } from "./skipton/adapter.js";
import { virginMoneyAdapter } from "./virgin-money/adapter.js";
import type { LenderAdapter } from "./types.js";
import type { LenderId } from "../domain/contracts.js";

const adapters = new Map<LenderId, LenderAdapter>([
  [barclaysAdapter.lender, barclaysAdapter],
  [halifaxAdapter.lender, halifaxAdapter],
  [hsbcAdapter.lender, hsbcAdapter],
  [kensingtonAdapter.lender, kensingtonAdapter],
  [natwestAdapter.lender, natwestAdapter],
  [nationwideAdapter.lender, nationwideAdapter],
  [santanderAdapter.lender, santanderAdapter],
  [skiptonAdapter.lender, skiptonAdapter],
  [virginMoneyAdapter.lender, virginMoneyAdapter]
]);

export function getAdapter(lender: LenderId): LenderAdapter {
  const adapter = adapters.get(lender);
  if (!adapter) {
    throw new Error(`No adapter registered for lender: ${lender}`);
  }
  return adapter;
}
