import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryTicketRepository } from "./ticket-repository.js";
import type { LenderReadyInput } from "../domain/contracts.js";

test("OFC tickets are opaque and can be redeemed only once", async () => {
  const repository = new InMemoryTicketRepository();
  const input = { lender: "halifax" } as LenderReadyInput;
  const token = await repository.issue({ caseId: "case-1", lender: "halifax", input, adapterVersion: "version-1" });

  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const redeemed = await repository.redeem(token);
  assert.equal(redeemed?.caseId, "case-1");
  assert.equal(redeemed?.lender, "halifax");
  assert.equal(redeemed?.input, input);
  assert.equal(redeemed?.adapterVersion, "version-1");
  assert.ok((redeemed?.expiresAt ?? 0) > Date.now());
  assert.equal(await repository.redeem(token), null);
  assert.equal(await repository.redeem("invalid"), null);
});
