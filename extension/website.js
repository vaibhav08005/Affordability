(() => {
  "use strict";
  const channel = "mortgage-affordability-extension-v1";
  const allowedOrigins = new Set([
    "https://mortgage-affordability-demo-476501925780.europe-west2.run.app",
    "http://localhost:3000", "http://localhost:3110",
    "http://127.0.0.1:3000", "http://127.0.0.1:3110"
  ]);
  const lenders = new Set(["barclays", "halifax", "hsbc", "kensington", "natwest", "nationwide", "santander", "skipton", "virgin_money"]);
  if (!allowedOrigins.has(location.origin)) return;

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.channel !== channel || data.type !== "OPEN_REQUEST" || typeof data.requestId !== "string") return;
    window.postMessage({ channel, type: "OPEN_ACK", requestId: data.requestId }, location.origin);
    let reply;
    try {
      if (!/^[a-z0-9-]{1,150}$/.test(data.caseId) || !lenders.has(data.lender)) throw new Error("Invalid case or lender.");
      const response = await fetch("/api/extension-input", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ caseId: data.caseId, lender: data.lender })
      });
      if (!(response.headers.get("content-type") || "").includes("application/json")) {
        throw new Error(`The website needs the extension API deployed (HTTP ${response.status}).`);
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Case request failed (HTTP ${response.status}).`);
      if (payload.caseId !== data.caseId || payload.lender !== data.lender || payload.input?.lender !== data.lender) {
        throw new Error("The website returned a mismatched lender case.");
      }
      const result = await chrome.runtime.sendMessage({ type: "OPEN_CALCULATOR", caseId: data.caseId, lender: data.lender, input: payload.input });
      if (!result?.ok) throw new Error(result?.error || "Chrome could not open the lender tab.");
      reply = { channel, type: "OPEN_RESULT", requestId: data.requestId, ok: true };
    } catch (error) {
      reply = { channel, type: "OPEN_RESULT", requestId: data.requestId, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    window.postMessage(reply, location.origin);
  });
})();
