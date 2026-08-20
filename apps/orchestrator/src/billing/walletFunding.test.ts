import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cdpMocks = vi.hoisted(() => ({
  getOrCreateAccount: vi.fn(),
  listSpendPermissions: vi.fn(),
  useSpendPermission: vi.fn(),
}));

vi.mock("@coinbase/cdp-sdk", () => {
  class MockCdpClient {
    evm = {
      getOrCreateAccount: cdpMocks.getOrCreateAccount,
      listSpendPermissions: cdpMocks.listSpendPermissions,
    };
  }
  return { CdpClient: MockCdpClient };
});

const SPENDER_ADDRESS = "0x1111111111111111111111111111111111111c";
const OPERATOR_ADDRESS = "0x2222222222222222222222222222222222222c";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

async function connectWallet() {
  const { saveConnection } = await import("../db/connectionsRepo.js");
  saveConnection("coinbase", {
    cdpApiKeyId: "test-key-id",
    cdpApiKeySecret: "test-key-secret",
    cdpWalletSecret: "test-wallet-secret",
    operatorAddress: OPERATOR_ADDRESS,
  });
}

function mockSpender() {
  cdpMocks.getOrCreateAccount.mockResolvedValue({
    address: SPENDER_ADDRESS,
    useSpendPermission: cdpMocks.useSpendPermission,
  });
}

function fakePermission(overrides: Partial<{ permissionHash: string; spender: string; token: string; allowance: bigint }> = {}) {
  return {
    permissionHash: overrides.permissionHash ?? "0xhash1",
    permission: {
      account: OPERATOR_ADDRESS,
      spender: overrides.spender ?? SPENDER_ADDRESS,
      token: overrides.token ?? USDC_BASE,
      allowance: overrides.allowance ?? 50_000_000n,
      period: 604800,
      start: 0,
      end: 0,
      salt: 0n,
      extraData: "0x",
    },
  };
}

describe("walletFunding", () => {
  beforeEach(() => {
    Object.values(cdpMocks).forEach((mock) => mock.mockReset());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses to read the spender address before Coinbase is connected", async () => {
    const { getSpenderAddress } = await import("./walletFunding.js");
    await expect(getSpenderAddress()).rejects.toThrow(/not connected/i);
  });

  it("returns Jarvis's spender address once connected", async () => {
    await connectWallet();
    mockSpender();
    const { getSpenderAddress } = await import("./walletFunding.js");
    expect(await getSpenderAddress()).toBe(SPENDER_ADDRESS);
  });

  it("lists only permissions granted to Jarvis's own spender address, not every permission on the wallet", async () => {
    await connectWallet();
    mockSpender();
    cdpMocks.listSpendPermissions.mockResolvedValue({
      spendPermissions: [
        fakePermission({ permissionHash: "0xours", spender: SPENDER_ADDRESS }),
        fakePermission({ permissionHash: "0xsomeone-elses", spender: "0x9999999999999999999999999999999999999c" }),
      ],
    });
    const { listGrantedPermissions } = await import("./walletFunding.js");
    const permissions = await listGrantedPermissions();
    expect(permissions).toHaveLength(1);
    expect(permissions[0].permissionHash).toBe("0xours");
    expect(permissions[0].tokenLabel).toBe("USDC");
    // Serialized as a decimal string, not a bigint (JSON can't carry bigint).
    expect(permissions[0].allowanceMinor).toBe("50000000");
  });

  it("labels an unrecognized token as null rather than guessing", async () => {
    await connectWallet();
    mockSpender();
    cdpMocks.listSpendPermissions.mockResolvedValue({
      spendPermissions: [fakePermission({ token: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" })],
    });
    const { listGrantedPermissions } = await import("./walletFunding.js");
    const permissions = await listGrantedPermissions();
    expect(permissions[0].tokenLabel).toBeNull();
  });

  it("refuses to spend against an unknown permission hash", async () => {
    await connectWallet();
    mockSpender();
    cdpMocks.listSpendPermissions.mockResolvedValue({ spendPermissions: [] });
    const { spendFromPermission } = await import("./walletFunding.js");
    await expect(
      spendFromPermission({ purposeLabel: "Anthropic Console", amountMinor: 1_000_000, permissionHash: "0xnope" })
    ).rejects.toThrow(/no such spend permission/i);
    expect(cdpMocks.useSpendPermission).not.toHaveBeenCalled();
  });

  it("refuses to spend a permission that wasn't actually granted to Jarvis's spender", async () => {
    await connectWallet();
    mockSpender();
    cdpMocks.listSpendPermissions.mockResolvedValue({
      spendPermissions: [fakePermission({ permissionHash: "0xnotours", spender: "0x9999999999999999999999999999999999999c" })],
    });
    const { spendFromPermission } = await import("./walletFunding.js");
    await expect(
      spendFromPermission({ purposeLabel: "Anthropic Console", amountMinor: 1_000_000, permissionHash: "0xnotours" })
    ).rejects.toThrow(/not granted to jarvis/i);
    expect(cdpMocks.useSpendPermission).not.toHaveBeenCalled();
  });

  it("spends within a valid permission and records the transaction locally", async () => {
    await connectWallet();
    mockSpender();
    cdpMocks.listSpendPermissions.mockResolvedValue({ spendPermissions: [fakePermission({ permissionHash: "0xgood" })] });
    cdpMocks.useSpendPermission.mockResolvedValue({ transactionHash: "0xtxhash123" });

    const { spendFromPermission, listWalletSpends } = await import("./walletFunding.js");
    const spend = await spendFromPermission({
      purposeLabel: "Anthropic Console",
      amountMinor: 5_000_000,
      permissionHash: "0xgood",
    });

    expect(spend).toMatchObject({ purposeLabel: "Anthropic Console", amountMinor: 5_000_000, txHash: "0xtxhash123" });
    expect(cdpMocks.useSpendPermission).toHaveBeenCalledWith(
      expect.objectContaining({ value: 5_000_000n, network: "base" })
    );

    const recorded = listWalletSpends().find((s) => s.txHash === "0xtxhash123");
    expect(recorded).toBeDefined();
  });
});
