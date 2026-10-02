import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { customerWidgetScript } from "./widget.js";

const POLICY = {
  enabled: false, autoReplyWebsite: true, autoReplyEmail: false, autoReplySocial: false,
  confidenceThreshold: .9, maxAutoRepliesPerConversation: 3,
  businessHoursStart: "08:00", businessHoursEnd: "18:00", businessDays: [1, 2, 3, 4, 5],
  escalationKeywords: [], widgetName: "Support", widgetWelcome: "Hello", allowedOrigins: [], updatedAt: null,
};

/**
 * Runs the real served widget script on a page and starts a conversation,
 * returning the JSON body it POSTed. `storage` carries localStorage across
 * page loads, standing in for one visitor browsing several pages.
 */
async function startChatOn(url: string, referrer: string, storage: Record<string, string> = {}) {
  const posts: Array<Record<string, unknown>> = [];
  const dom = new JSDOM(`<!doctype html><body></body>`, {
    url,
    ...(referrer ? { referrer } : {}),
    runScripts: "dangerously",
    beforeParse(window) {
      for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
      window.fetch = (async (_input: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "POST") posts.push(JSON.parse(init.body ?? "{}"));
        return { ok: true, json: async () => ({ conversationId: "c1", token: "t".repeat(40), messages: [] }) };
      }) as unknown as typeof window.fetch;
      window.setInterval = (() => 0) as unknown as typeof window.setInterval;
    },
  });
  const { document } = dom.window;
  const script = document.createElement("script");
  script.dataset.jarvisUrl = "https://jarvis.example";
  script.textContent = customerWidgetScript(POLICY);
  document.body.appendChild(script);

  const root = document.getElementById("jarvis-customer-chat")!.shadowRoot!;
  (root.querySelector(".name") as HTMLInputElement).value = "Robin";
  (root.querySelector(".first") as HTMLTextAreaElement).value = "Hi there";
  (root.querySelector(".begin") as HTMLButtonElement).click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const saved: Record<string, string> = {};
  for (let i = 0; i < dom.window.localStorage.length; i++) {
    const key = dom.window.localStorage.key(i)!;
    if (key !== "jarvis-chat") saved[key] = dom.window.localStorage.getItem(key)!;
  }
  dom.window.close();
  return { body: posts[0], storage: saved };
}

describe("customer chat widget, running", () => {
  it("leaves out absent source fields instead of sending null", async () => {
    const { body } = await startChatOn("https://shop.example/", "");
    expect(body).toEqual({ customerName: "Robin", customerEmail: "", body: "Hi there" });
  });

  it("sends the landing page's UTM tags and external referrer", async () => {
    const { body } = await startChatOn("https://shop.example/?utm_source=twitter&utm_campaign=launch", "https://t.co/abc");
    expect(body).toMatchObject({ utmSource: "twitter", utmCampaign: "launch", referrer: "https://t.co/abc" });
    expect(body).not.toHaveProperty("utmMedium");
  });

  it("remembers the first touch when chat starts on a later page", async () => {
    const landing = await startChatOn("https://shop.example/?utm_source=newsletter", "https://mail.google.com/");
    // Second page: internal referrer, no UTM tags, same browser storage.
    const { body } = await startChatOn("https://shop.example/pricing", "https://shop.example/", landing.storage);
    expect(body).toMatchObject({ utmSource: "newsletter", referrer: "https://mail.google.com/" });
  });

  it("never counts internal navigation as a source", async () => {
    const { body, storage } = await startChatOn("https://shop.example/pricing", "https://shop.example/");
    expect(body).not.toHaveProperty("referrer");
    expect(storage).not.toHaveProperty("jarvis-touch");
  });
});
