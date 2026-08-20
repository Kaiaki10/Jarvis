import { afterEach, describe, expect, it, vi } from "vitest";

function email(overrides: Partial<{
  sender: { name: string; email: string };
  recipients: string[];
  subject: string;
  body: string;
  messageId: string;
  eventId: string;
}> = {}) {
  return {
    sender: { name: "X", email: "verify@x.com" },
    recipients: ["signup@example.com"],
    subject: "Confirm your email",
    body: "Click here to confirm: https://x.com/account/confirm_email?token=abc123",
    messageId: "msg-1",
    eventId: "evt-1",
    ...overrides,
  };
}

// signup_email_events is never cleared between tests (there's no cancel-style
// export for it, matching the pattern of only clearing progress once a
// platform is connected), so every assertion below scopes to a subject
// unique to the test that produced it, rather than the raw list length.

describe("signupInbox", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("starting a signup is readable back, and cancelling removes it", async () => {
    const { startPlatformSignup, getSignupProgress, clearSignupProgress } = await import("./signupInbox.js");
    startPlatformSignup("x", { signupEmail: "Signup@Example.com" });
    const progress = getSignupProgress("x");
    // Stored lowercased, so matching against a recipient address doesn't care about case.
    expect(progress?.signupEmail).toBe("signup@example.com");
    expect(progress?.autoFollow).toBe(false);

    clearSignupProgress("x");
    expect(getSignupProgress("x")).toBeUndefined();
  });

  it("an email to an address nobody is watching is left alone", async () => {
    const { handleSignupConfirmationEmail } = await import("./signupInbox.js");
    const claimed = handleSignupConfirmationEmail(email({ recipients: ["nobody-is-watching@example.com"] }));
    expect(claimed).toBe(false);
  });

  it("claims a matching email, extracts the link via the platform's pattern, and surfaces it by default", async () => {
    const { startPlatformSignup, handleSignupConfirmationEmail, listSignupEmailEvents } = await import(
      "./signupInbox.js"
    );
    startPlatformSignup("x", { signupEmail: "surface-test@example.com" });

    const claimed = handleSignupConfirmationEmail(
      email({ recipients: ["surface-test@example.com"], subject: "surface-test", eventId: "evt-surface" })
    );
    expect(claimed).toBe(true);

    const events = listSignupEmailEvents("x").filter((e) => e.subject === "surface-test");
    expect(events).toHaveLength(1);
    expect(events[0].matchedLink).toBe("https://x.com/account/confirm_email?token=abc123");
    expect(events[0].action).toBe("surfaced");
  });

  it("degrades gracefully when the platform has no confirmationLinkPattern or the body doesn't match one", async () => {
    const { startPlatformSignup, handleSignupConfirmationEmail, listSignupEmailEvents } = await import(
      "./signupInbox.js"
    );
    // slack has no confirmationLinkPattern defined at all.
    startPlatformSignup("slack", { signupEmail: "degrade-test@example.com" });
    handleSignupConfirmationEmail(
      email({ recipients: ["degrade-test@example.com"], subject: "degrade-test", eventId: "evt-degrade" })
    );

    const events = listSignupEmailEvents("slack").filter((e) => e.subject === "degrade-test");
    expect(events).toHaveLength(1);
    expect(events[0].matchedLink).toBeNull();
    expect(events[0].action).toBe("surfaced");
  });

  it("auto-follows the link when the operator opted in, and only then", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const { startPlatformSignup, handleSignupConfirmationEmail, listSignupEmailEvents } = await import(
      "./signupInbox.js"
    );
    startPlatformSignup("x", { signupEmail: "autofollow-on@example.com", autoFollow: true });
    handleSignupConfirmationEmail(
      email({ recipients: ["autofollow-on@example.com"], subject: "autofollow-on", eventId: "evt-af-on" })
    );

    // followConfirmationLink is fire-and-forget; give its microtask a tick.
    await new Promise((resolve) => setImmediate(resolve));

    const events = listSignupEmailEvents("x").filter((e) => e.subject === "autofollow-on");
    expect(events[0].action).toBe("auto_followed");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://x.com/account/confirm_email?token=abc123",
      expect.objectContaining({ redirect: "follow" })
    );
  });

  it("never auto-follows when autoFollow is off, even with a matched link", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const { startPlatformSignup, handleSignupConfirmationEmail } = await import("./signupInbox.js");
    startPlatformSignup("x", { signupEmail: "autofollow-off@example.com", autoFollow: false });
    handleSignupConfirmationEmail(
      email({ recipients: ["autofollow-off@example.com"], subject: "autofollow-off", eventId: "evt-af-off" })
    );

    await new Promise((resolve) => setImmediate(resolve));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the same inbound event is never recorded twice", async () => {
    const { startPlatformSignup, handleSignupConfirmationEmail, listSignupEmailEvents } = await import(
      "./signupInbox.js"
    );
    startPlatformSignup("x", { signupEmail: "dedupe-test@example.com" });
    const dupe = email({ recipients: ["dedupe-test@example.com"], subject: "dedupe-test", eventId: "evt-dupe" });
    handleSignupConfirmationEmail(dupe);
    handleSignupConfirmationEmail(dupe);
    handleSignupConfirmationEmail(dupe);

    expect(listSignupEmailEvents("x").filter((e) => e.subject === "dedupe-test")).toHaveLength(1);
  });

  it("claims the email for every platform waiting on the same address, not just one", async () => {
    const { startPlatformSignup, handleSignupConfirmationEmail, listSignupEmailEvents } = await import(
      "./signupInbox.js"
    );
    // A deliberately unusual setup: two platforms both waiting on one address.
    startPlatformSignup("x", { signupEmail: "shared@example.com" });
    startPlatformSignup("slack", { signupEmail: "shared@example.com" });

    const claimed = handleSignupConfirmationEmail(
      email({ recipients: ["shared@example.com"], subject: "shared-address", eventId: "evt-shared" })
    );
    expect(claimed).toBe(true);
    expect(listSignupEmailEvents("x").filter((e) => e.subject === "shared-address")).toHaveLength(1);
    expect(listSignupEmailEvents("slack").filter((e) => e.subject === "shared-address")).toHaveLength(1);
  });
});
