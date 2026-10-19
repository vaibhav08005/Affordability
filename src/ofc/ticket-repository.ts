import { createHash, randomBytes } from "node:crypto";
import { Firestore } from "@google-cloud/firestore";
import type { LenderId, LenderReadyInput } from "../domain/contracts.js";

const ticketLifetimeMs = 2 * 60 * 1000;

export interface OfcTicket {
  caseId: string;
  lender: LenderId;
  input: LenderReadyInput;
  adapterVersion: string;
  lenderAdapterVersion?: string;
  expiresAt: number;
}

export interface TicketRepository {
  issue(ticket: Omit<OfcTicket, "expiresAt">): Promise<string>;
  redeem(token: string): Promise<OfcTicket | null>;
}

export class InMemoryTicketRepository implements TicketRepository {
  private readonly tickets = new Map<string, OfcTicket>();

  async issue(ticket: Omit<OfcTicket, "expiresAt">): Promise<string> {
    const token = newToken();
    this.purgeExpired();
    this.tickets.set(tokenHash(token), { ...ticket, expiresAt: Date.now() + ticketLifetimeMs });
    return token;
  }

  async redeem(token: string): Promise<OfcTicket | null> {
    if (!validToken(token)) return null;
    const key = tokenHash(token);
    const ticket = this.tickets.get(key);
    this.tickets.delete(key);
    return ticket && ticket.expiresAt > Date.now() ? ticket : null;
  }

  private purgeExpired(): void {
    for (const [key, ticket] of this.tickets) {
      if (ticket.expiresAt <= Date.now()) this.tickets.delete(key);
    }
  }
}

export class FirestoreTicketRepository implements TicketRepository {
  private readonly firestore = new Firestore({ ignoreUndefinedProperties: true });

  async issue(ticket: Omit<OfcTicket, "expiresAt">): Promise<string> {
    const token = newToken();
    await this.firestore.collection("ofcTickets").doc(tokenHash(token)).create({
      ...ticket,
      expiresAt: Date.now() + ticketLifetimeMs,
      deleteAt: new Date(Date.now() + ticketLifetimeMs)
    });
    return token;
  }

  async redeem(token: string): Promise<OfcTicket | null> {
    if (!validToken(token)) return null;
    const ref = this.firestore.collection("ofcTickets").doc(tokenHash(token));
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;
      const ticket = snapshot.data() as OfcTicket;
      if (ticket.expiresAt <= Date.now()) return null;
      transaction.delete(ref);
      return {
        caseId: ticket.caseId,
        lender: ticket.lender,
        input: ticket.input,
        adapterVersion: ticket.adapterVersion,
        lenderAdapterVersion: ticket.lenderAdapterVersion,
        expiresAt: ticket.expiresAt
      };
    });
  }
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function validToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
