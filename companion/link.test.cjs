const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parseLink } = require("./link.cjs");

const ticket = "x".repeat(43);
const query = `ticket=${ticket}&server=${encodeURIComponent("http://localhost:3000")}`;

test("accepts the website's OFC link", () => {
  assert.deepEqual(parseLink(`ofc://open?${query}`), { ticket, serverUrl: "http://localhost:3000" });
});

test("accepts the Windows-normalized slash path", () => {
  assert.deepEqual(parseLink(`ofc://open/?${query}`), { ticket, serverUrl: "http://localhost:3000" });
});

test("rejects other paths and invalid tickets", () => {
  assert.throws(() => parseLink(`ofc://open/other?${query}`), /Invalid Open Filled Calculator link/);
  assert.throws(() => parseLink("ofc://open/?ticket=short&server=http%3A%2F%2Flocalhost%3A3000"), /Invalid handoff ticket/);
});
