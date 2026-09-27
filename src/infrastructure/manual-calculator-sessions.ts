import { randomUUID } from "node:crypto";
import type { BrowserSession } from "../adapters/types.js";
import type { LenderId } from "../domain/contracts.js";

export interface ManualCalculatorSessionView {
  sessionId: string;
  caseId: string;
  lender: LenderId;
  openedAt: string;
}

interface ManualCalculatorSession extends ManualCalculatorSessionView {
  browserSession: BrowserSession;
  expiryTimer: ReturnType<typeof setTimeout>;
}

export class ManualCalculatorSessionManager {
  private readonly sessions = new Map<string, ManualCalculatorSession>();
  private readonly sessionIdsByCaseAndLender = new Map<string, string>();
  private readonly pendingSessions = new Map<string, Promise<string>>();

  constructor(private readonly maxSessionAgeMs = 60 * 60 * 1000) {}

  async open(
    caseId: string,
    lender: LenderId,
    createBrowserSession: () => Promise<BrowserSession>
  ): Promise<{ session: ManualCalculatorSessionView; reused: boolean }> {
    const key = sessionKey(caseId, lender);
    const existing = this.findActiveByKey(key);
    if (existing) {
      await existing.browserSession.page.bringToFront().catch(() => undefined);
      return { session: publicSession(existing), reused: true };
    }

    const pending = this.pendingSessions.get(key);
    if (pending) {
      const sessionId = await pending;
      const session = this.sessions.get(sessionId);
      if (session) {
        await session.browserSession.page.bringToFront().catch(() => undefined);
        return { session: publicSession(session), reused: true };
      }
      return this.open(caseId, lender, createBrowserSession);
    }

    const creation = this.createSession(caseId, lender, key, createBrowserSession);
    this.pendingSessions.set(key, creation);
    try {
      const sessionId = await creation;
      const session = this.sessions.get(sessionId);
      if (!session) throw new Error("The calculator window closed before it was ready.");
      return { session: publicSession(session), reused: false };
    } finally {
      if (this.pendingSessions.get(key) === creation) this.pendingSessions.delete(key);
    }
  }

  listForCase(caseId: string): ManualCalculatorSessionView[] {
    return Array.from(this.sessions.values())
      .filter((session) => session.caseId === caseId && !session.browserSession.page.isClosed())
      .map(publicSession);
  }

  async close(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.remove(session);
    await session.browserSession.close().catch(() => undefined);
    return true;
  }

  async closeAll(): Promise<void> {
    await Promise.all(Array.from(this.sessions.keys(), (sessionId) => this.close(sessionId)));
  }

  private async createSession(
    caseId: string,
    lender: LenderId,
    key: string,
    createBrowserSession: () => Promise<BrowserSession>
  ): Promise<string> {
    const browserSession = await createBrowserSession();
    if (browserSession.page.isClosed()) {
      await browserSession.close().catch(() => undefined);
      throw new Error("The calculator window was closed before it finished opening.");
    }

    const sessionId = randomUUID();
    const session: ManualCalculatorSession = {
      sessionId,
      caseId,
      lender,
      openedAt: new Date().toISOString(),
      browserSession,
      expiryTimer: setTimeout(() => {
        void this.close(sessionId);
      }, this.maxSessionAgeMs)
    };
    session.expiryTimer.unref?.();
    this.sessions.set(sessionId, session);
    this.sessionIdsByCaseAndLender.set(key, sessionId);
    browserSession.page.on("close", () => {
      void this.close(sessionId);
    });
    return sessionId;
  }

  private findActiveByKey(key: string): ManualCalculatorSession | undefined {
    const sessionId = this.sessionIdsByCaseAndLender.get(key);
    if (!sessionId) return undefined;
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.sessionIdsByCaseAndLender.delete(key);
      return undefined;
    }
    if (session.browserSession.page.isClosed()) {
      this.remove(session);
      return undefined;
    }
    return session;
  }

  private remove(session: ManualCalculatorSession): void {
    clearTimeout(session.expiryTimer);
    this.sessions.delete(session.sessionId);
    const key = sessionKey(session.caseId, session.lender);
    if (this.sessionIdsByCaseAndLender.get(key) === session.sessionId) {
      this.sessionIdsByCaseAndLender.delete(key);
    }
  }
}

function publicSession(session: ManualCalculatorSession): ManualCalculatorSessionView {
  return {
    sessionId: session.sessionId,
    caseId: session.caseId,
    lender: session.lender,
    openedAt: session.openedAt
  };
}

function sessionKey(caseId: string, lender: LenderId): string {
  return `${caseId}:${lender}`;
}
