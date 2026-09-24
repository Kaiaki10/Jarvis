import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Stripe from "stripe";

const WEBHOOK_SECRET = "whsec_test_receipt_secret";

function signedCheckoutEvent(sessionId: string, email: string, amountTotal: number) {
  const payload = JSON.stringify({
    id: "evt_test_receipt",
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        amount_total: amountTotal,
        currency: "usd",
        customer_details: { email, name: "Receipt Payer" },
      },
    },
  });
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { payload: Buffer.from(payload), header };
}

describe("stripe money-in webhook", () => {
  let connectionId: string | null = null;

  beforeEach(async () => {
    const { db } = await import("../db/db.js");
    db.exec("DELETE FROM money_receipts");
    db.exec("DELETE FROM money_payment_links");
    db.exec("DELETE FROM customers WHERE email = 'payer-receipt-test@example.com'");
    const { saveConnection } = await import("../db/connectionsRepo.js");
    saveConnection("stripe", {
      secretKey: "rk_test_abc",
      publishableKey: "pk_test_abc",
      cardholderId: "ich_test_abc",
      webhookSecret: WEBHOOK_SECRET,
    });
    const { getConnection } = await import("../db/connectionsRepo.js");
    connectionId = getConnection("stripe")?.id ?? null;
  });

  afterEach(async () => {
    // This suite shares one throwaway database file with every other test
    // file (see vitest.setup.ts), so it removes everything it created —
    // otherwise a leftover stripe connection breaks stripeFunding.test.ts's
    // "before Stripe is connected" test, which asserts on absence.
    const { db } = await import("../db/db.js");
    db.exec("DELETE FROM money_receipts");
    db.exec("DELETE FROM money_payment_links");
    db.exec("DELETE FROM customers WHERE email = 'payer-receipt-test@example.com'");
    if (connectionId) {
      const { deleteConnection } = await import("../db/connectionsRepo.js");
      deleteConnection(connectionId);
      connectionId = null;
    }
  });

  it("rejects a forged signature and records nothing", async () => {
    const { verifyStripeWebhook } = await import("./stripeFunding.js");
    const { db } = await import("../db/db.js");
    expect(() => verifyStripeWebhook(Buffer.from("{}"), "t=123,v1=forged")).toThrow();
    const count = (db.prepare("SELECT COUNT(*) AS n FROM money_receipts").get() as unknown as { n: number }).n;
    expect(count).toBe(0);
  });

  it("records a completed checkout once across Stripe retries", async () => {
    const { verifyStripeWebhook, recordStripeReceipt, listMoneyReceipts } = await import("./stripeFunding.js");
    const { getCustomerByEmail } = await import("../db/customerRepo.js");
    const { payload, header } = signedCheckoutEvent("cs_test_receipt_1", "payer-receipt-test@example.com", 25000);

    const event = verifyStripeWebhook(payload, header);
    expect(event.type).toBe("checkout.session.completed");

    const first = recordStripeReceipt(event.data.object as Stripe.Checkout.Session);
    expect(first.duplicate).toBe(false);
    expect(first.receipt).toMatchObject({ id: "cs_test_receipt_1", amountMinor: 25000, currency: "USD" });

    // The payer becomes a customer with the revenue on their record.
    expect(getCustomerByEmail("payer-receipt-test@example.com")?.revenueMinor).toBe(25000);

    // The receipt lands in the measurement ledger as a lead-source fact.
    const { db } = await import("../db/db.js");
    const fact = db.prepare(
      `SELECT source, metric, value, currency FROM measurement_facts WHERE metric = 'revenue_minor' AND value = 25000 ORDER BY captured_at DESC LIMIT 1`
    ).get() as unknown as { source: string; metric: string; value: number; currency: string };
    expect(fact).toMatchObject({ source: "lead", metric: "revenue_minor", value: 25000, currency: "USD" });

    // Stripe's retry carries the same session id: acknowledged, not double-counted.
    const retry = recordStripeReceipt(event.data.object as Stripe.Checkout.Session);
    expect(retry.duplicate).toBe(true);
    expect(getCustomerByEmail("payer-receipt-test@example.com")?.revenueMinor).toBe(25000);
    expect(listMoneyReceipts().filter((r) => r.id === "cs_test_receipt_1")).toHaveLength(1);
  });
});
