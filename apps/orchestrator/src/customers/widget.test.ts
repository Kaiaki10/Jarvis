import { describe, expect, it } from "vitest";
import { customerWidgetScript } from "./widget.js";

describe("customer chat widget", () => {
  it("renders policy branding without allowing markup injection", () => {
    const script = customerWidgetScript({
      enabled: false, autoReplyWebsite: true, autoReplyEmail: false, autoReplySocial: false,
      confidenceThreshold: .9, maxAutoRepliesPerConversation: 3,
      businessHoursStart: "08:00", businessHoursEnd: "18:00", businessDays: [1, 2, 3, 4, 5],
      escalationKeywords: [], widgetName: "Jarvis <Support>", widgetWelcome: "Hello", allowedOrigins: [], updatedAt: null,
    });
    expect(script).toContain("Jarvis \\u003cSupport>");
    expect(script).toContain("attachShadow");
    expect(script).toContain("localStorage");
  });
});
