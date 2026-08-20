import { beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  process.env.JARVIS_KEY_PATH = join(
    mkdtempSync(join(tmpdir(), "jarvis-approval-key-")),
    "jarvis.key"
  );
});

describe("approvalToken", () => {
  it("round-trips a freshly created token", async () => {
    const { createApprovalToken, verifyApprovalToken } = await import("./approvalToken.js");
    const token = createApprovalToken("session-1", "request-1", 60_000);
    const payload = verifyApprovalToken(token);
    expect(payload?.sessionId).toBe("session-1");
    expect(payload?.requestId).toBe("request-1");
  });

  it("is url-safe, so it survives being put in a push notification link", async () => {
    const { createApprovalToken } = await import("./approvalToken.js");
    const token = createApprovalToken("session-1", "request-1", 60_000);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it("rejects a token whose payload was tampered with", async () => {
    const { createApprovalToken, verifyApprovalToken } = await import("./approvalToken.js");
    const token = createApprovalToken("session-1", "request-1", 60_000);
    const [payloadB64, sig] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    // Swap in a different session without re-signing — this is exactly what an
    // attacker gains nothing from unless the signature also happens to match.
    decoded.sessionId = "someone-elses-session";
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${sig}`;
    expect(verifyApprovalToken(forged)).toBeNull();
  });

  it("rejects a token whose signature was tampered with", async () => {
    const { createApprovalToken, verifyApprovalToken } = await import("./approvalToken.js");
    const token = createApprovalToken("session-1", "request-1", 60_000);
    const [payloadB64] = token.split(".");
    expect(verifyApprovalToken(`${payloadB64}.not-the-real-signature`)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { createApprovalToken, verifyApprovalToken } = await import("./approvalToken.js");
    const token = createApprovalToken("session-1", "request-1", -1);
    expect(verifyApprovalToken(token)).toBeNull();
  });

  it("rejects garbage input without throwing", async () => {
    const { verifyApprovalToken } = await import("./approvalToken.js");
    expect(verifyApprovalToken("")).toBeNull();
    expect(verifyApprovalToken("not-a-real-token")).toBeNull();
    expect(verifyApprovalToken("also.not.valid.at.all")).toBeNull();
  });

  it("prefers a real Wi-Fi/Ethernet adapter over a VPN tunnel", async () => {
    const { lanAddress } = await import("./approvalToken.js");
    // Reproduces the exact shape found on the first real machine this ran on:
    // a NordVPN (NordLynx) adapter enumerated before the actual Wi-Fi adapter.
    const interfaces = {
      NordLynx: [{ family: "IPv4", internal: false, address: "10.5.0.2" } as any],
      "Wi-Fi": [{ family: "IPv4", internal: false, address: "192.168.254.178" } as any],
      "Loopback Pseudo-Interface 1": [{ family: "IPv4", internal: true, address: "127.0.0.1" } as any],
    };
    expect(lanAddress(interfaces)).toBe("192.168.254.178");
  });

  it("falls back to any non-VPN-looking adapter if nothing looks like Wi-Fi/Ethernet", async () => {
    const { lanAddress } = await import("./approvalToken.js");
    const interfaces = {
      NordLynx: [{ family: "IPv4", internal: false, address: "10.5.0.2" } as any],
      "vEthernet (Default Switch)": [{ family: "IPv4", internal: false, address: "172.20.0.1" } as any],
      MyMysteryAdapter: [{ family: "IPv4", internal: false, address: "192.168.1.50" } as any],
    };
    expect(lanAddress(interfaces)).toBe("192.168.1.50");
  });

  it("respects JARVIS_APPROVE_HOST as an override for a setup the heuristic gets wrong", async () => {
    process.env.JARVIS_APPROVE_HOST = "192.168.1.99";
    try {
      const { lanAddress } = await import("./approvalToken.js");
      expect(lanAddress({})).toBe("192.168.1.99");
    } finally {
      delete process.env.JARVIS_APPROVE_HOST;
    }
  });

  it("only verifies against the key it was signed with", async () => {
    const { createApprovalToken } = await import("./approvalToken.js");
    const token = createApprovalToken("session-1", "request-1", 60_000);

    // A fresh module registry with a different key file — simulates a token
    // forged without ever having had access to this machine's key.
    process.env.JARVIS_KEY_PATH = join(
      mkdtempSync(join(tmpdir(), "jarvis-approval-key-other-")),
      "jarvis.key"
    );
    vi.resetModules();
    const { verifyApprovalToken: verifyWithDifferentKey } = await import("./approvalToken.js");
    expect(verifyWithDifferentKey(token)).toBeNull();
  });
});
