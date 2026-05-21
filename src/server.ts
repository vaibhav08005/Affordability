import express from "express";
import { randomUUID } from "node:crypto";
import { loadRunContext } from "./config.js";
import { runAffordabilityAutomation } from "./service.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.post("/runs", async (request, response) => {
  const runId = randomUUID();
  try {
    const result = await runAffordabilityAutomation(request.body, loadRunContext());
    response.status(result.status === "success" ? 200 : 422).json({ runId, result });
  } catch (error) {
    response.status(400).json({
      runId,
      result: {
        lender: request.body?.lender ?? "unknown",
        status: "failed",
        maximumBorrowing: null,
        monthlyPayment: null,
        messages: [],
        evidence: { timestamp: new Date().toISOString() },
        error: {
          category: "validation",
          message: error instanceof Error ? error.message : String(error)
        }
      }
    });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Affordability automation API listening on ${port}`);
});
