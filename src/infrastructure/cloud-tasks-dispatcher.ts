import { CloudTasksClient } from "@google-cloud/tasks";
import type { LenderId } from "../domain/contracts.js";

export interface LenderTaskPayload {
  runId: string;
  caseId: string;
  lender: LenderId;
}

export interface LenderTaskDispatcher {
  enqueueLenderTask(payload: LenderTaskPayload): Promise<void>;
}

export class CloudTasksLenderTaskDispatcher implements LenderTaskDispatcher {
  private readonly client = new CloudTasksClient();
  private readonly queuePath: string;
  private readonly workerUrl: string;
  private readonly serviceAccountEmail?: string;
  private readonly sharedSecret?: string;

  constructor() {
    const project = requiredEnv("GOOGLE_CLOUD_PROJECT", "GCP_PROJECT", "PROJECT_ID");
    const location = requiredEnv("CLOUD_TASKS_LOCATION", "CLOUD_TASKS_REGION");
    const queue = requiredEnv("CLOUD_TASKS_QUEUE");
    this.workerUrl = requiredEnv("WORKER_URL");
    this.serviceAccountEmail = process.env.WORKER_INVOKER_SERVICE_ACCOUNT;
    this.sharedSecret = process.env.WORKER_SHARED_SECRET;
    this.queuePath = this.client.queuePath(project, location, queue);
  }

  async enqueueLenderTask(payload: LenderTaskPayload): Promise<void> {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64");
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (this.sharedSecret) {
      headers["X-Worker-Secret"] = this.sharedSecret;
    }

    await this.client.createTask({
      parent: this.queuePath,
      task: {
        httpRequest: {
          httpMethod: "POST",
          url: this.workerUrl,
          headers,
          body,
          oidcToken: this.serviceAccountEmail
            ? {
                serviceAccountEmail: this.serviceAccountEmail,
                audience: new URL(this.workerUrl).origin
              }
            : undefined
        }
      }
    });
  }
}

export class InlineLenderTaskDispatcher implements LenderTaskDispatcher {
  constructor(private readonly handler: (payload: LenderTaskPayload) => Promise<void>) {}

  async enqueueLenderTask(payload: LenderTaskPayload): Promise<void> {
    void this.handler(payload);
  }
}

export function cloudTasksConfigured(): boolean {
  return Boolean(
    (process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || process.env.PROJECT_ID) &&
    (process.env.CLOUD_TASKS_LOCATION || process.env.CLOUD_TASKS_REGION) &&
    process.env.CLOUD_TASKS_QUEUE &&
    process.env.WORKER_URL
  );
}

function requiredEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
}
