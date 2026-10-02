import { describe, expect, it } from "vitest";
import { inferAcquisitionChannel } from "./acquisition.js";

const website = (extra: { utmSource?: string | null; utmMedium?: string | null; referrer?: string | null }) =>
  inferAcquisitionChannel({ conversationChannel: "website", ...extra });

describe("inferAcquisitionChannel", () => {
  it("maps UTM sources to their channel, case-insensitively", () => {
    expect(website({ utmSource: "Twitter" })).toBe("x");
    expect(website({ utmSource: "x" })).toBe("x");
    expect(website({ utmSource: "ig" })).toBe("instagram");
    expect(website({ utmSource: "facebook" })).toBe("facebook");
    expect(website({ utmSource: "newsletter" })).toBe("email");
    expect(website({ utmSource: "google" })).toBe("search");
    expect(website({ utmMedium: "email" })).toBe("email");
  });

  it("treats a tagged link from an unknown source as a referral", () => {
    expect(website({ utmSource: "some-podcast" })).toBe("referral");
    expect(website({ utmMedium: "partner" })).toBe("referral");
  });

  it("prefers UTM tags over the referrer", () => {
    expect(website({ utmSource: "newsletter", referrer: "https://t.co/abc" })).toBe("email");
  });

  it("falls back to the referrer host", () => {
    expect(website({ referrer: "https://t.co/abc123" })).toBe("x");
    expect(website({ referrer: "https://l.instagram.com/?u=x" })).toBe("instagram");
    expect(website({ referrer: "https://m.facebook.com/" })).toBe("facebook");
    expect(website({ referrer: "https://www.google.co.uk/" })).toBe("search");
    expect(website({ referrer: "https://duckduckgo.com/" })).toBe("search");
    expect(website({ referrer: "https://mail.google.com/mail/u/0/" })).toBe("email");
    expect(website({ referrer: "https://someblog.example/post" })).toBe("referral");
  });

  it("does not mistake a lookalike host for a platform", () => {
    expect(website({ referrer: "https://notx.com/" })).toBe("referral");
    expect(website({ referrer: "https://evilinstagram.com/" })).toBe("referral");
  });

  it("calls a website visitor with no evidence direct, including unparseable referrers", () => {
    expect(website({})).toBe("direct");
    expect(website({ referrer: "" })).toBe("direct");
    expect(website({ referrer: "not a url" })).toBe("direct");
  });

  it("attributes platform messages to the platform unless tagged otherwise", () => {
    expect(inferAcquisitionChannel({ conversationChannel: "x" })).toBe("x");
    expect(inferAcquisitionChannel({ conversationChannel: "instagram" })).toBe("instagram");
    expect(inferAcquisitionChannel({ conversationChannel: "email" })).toBe("email");
    expect(inferAcquisitionChannel({ conversationChannel: "email", utmSource: "x" })).toBe("x");
  });
});
