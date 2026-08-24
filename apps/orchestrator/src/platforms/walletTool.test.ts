import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/db.js";
import { saveConnection, recordTestResult, listConnections } from "../db/connectionsRepo.js";
import { buildPlatformToolset } from "./actions.js";

/**
 * Whether the wallet contributed tools to this session.
 *
 * Asserted through the capability summary rather than by reaching into the MCP
 * server: `buildPlatformToolset` records a platform's name only *after* its
 * builder has pushed its tools, so a name in the summary is proof the builder
 * ran. The server's own tool registry is SDK-internal and would make this test
 * a hostage to their refactors.
 */
function walletToolsPresent(): boolean {
  return buildPlatformToolset().capabilitySummary.includes("Coinbase Wallet");
}

function connectCoinbase(passedTest: boolean) {
  const connection = saveConnection("coinbase", {
    cdpApiKeyId: "id",
    cdpApiKeySecret: "secret",
    cdpWalletSecret: "wallet",
    operatorAddress: "0x2222222222222222222222222222222222222222",
  });
  recordTestResult(connection.id, passedTest, null, null);
}

describe("the wallet tool", () => {
  beforeEach(() => {
    for (const connection of listConnections()) {
      db.prepare("DELETE FROM connections WHERE id = ?").run(connection.id);
    }
  });

  it("does not exist at all until a wallet is connected", () => {
    // The strongest guarantee available: a tool that was never built cannot be
    // called, however the model is prompted.
    expect(walletToolsPresent()).toBe(false);
    expect(buildPlatformToolset().capabilitySummary).toMatch(/No external platforms are connected/i);
  });

  it("does not exist for a wallet whose credentials failed their test", () => {
    connectCoinbase(false);
    expect(walletToolsPresent()).toBe(false);
  });

  it("appears once the wallet is connected", () => {
    connectCoinbase(true);
    expect(walletToolsPresent()).toBe(true);
  });

  it("is never auto-approved, so moving money always asks first", () => {
    connectCoinbase(true);
    const toolset = buildPlatformToolset();
    // Only read-only tools are pre-allowed; anything that moves money or
    // publishes has to pass the approval gate every time.
    for (const name of toolset.autoAllowTools) {
      expect(name).toMatch(/list_available_images/);
    }
    expect(toolset.autoAllowTools).not.toContain("mcp__jarvis__draw_usdc_from_wallet");
  });
});
