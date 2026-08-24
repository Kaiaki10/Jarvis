import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cdpMocks = vi.hoisted(() => ({
  getOrCreateAccount: vi.fn(),
  listSpendPermissions: vi.fn(),
  useSpendPermission: vi.fn(),
  listSmartAccounts: vi.fn(),
  createSpendPermission: vi.fn(),
  revokeSpendPermission: vi.fn(),
}));

vi.mock("@coinbase/cdp-sdk", () => {
  class MockCdpClient {
    evm = {
      getOrCreateAccount: cdpMocks.getOrCreateAccount,
      listSpendPermissions: cdpMocks.listSpendPermissions,
      listSmartAccounts: cdpMocks.listSmartAccounts,
      createSpendPermission: cdpMocks.createSpendPermission,
      revokeSpendPermission: cdpMocks.revokeSpendPermission,
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

  it("refuses to spend on a rail with no envelope, before touching the chain", async () => {
    await connectWallet();
    mockSpender();
    cdpMocks.listSpendPermissions.mockResolvedValue({ spendPermissions: [fakePermission({ permissionHash: "0xgood" })] });

    const { spendFromPermission } = await import("./walletFunding.js");
    await expect(
      spendFromPermission({ purposeLabel: "Unbudgeted", amountMinor: 1_000, permissionHash: "0xgood" })
    ).rejects.toThrow(/No spending limit is set/);

    // The point of checking first: no transaction, so no gas was burned.
    expect(cdpMocks.useSpendPermission).not.toHaveBeenCalled();
  });

  it("spends within a valid permission and records the transaction locally", async () => {
    await connectWallet();
    mockSpender();
    // An envelope is now required before any spend — see billing/envelopes.ts.
    const { setEnvelope } = await import("./envelopes.js");
    setEnvelope({ rail: "wallet", period: "day", limitMinor: 10_000_000, currency: "USDC" });
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

describe("granting and revoking", () => {
  beforeEach(() => {
    Object.values(cdpMocks).forEach((mock) => mock.mockReset());
  });

  it("says a wallet from another project cannot be granted from here", async () => {
    await connectWallet();
    cdpMocks.listSmartAccounts.mockResolvedValue({
      accounts: [{ address: "0x9999999999999999999999999999999999999999" }],
    });
    const { operatorWalletIsManaged } = await import("./walletFunding.js");
    expect(await operatorWalletIsManaged()).toBe(false);
  });

  it("recognises the operator's wallet regardless of address casing", async () => {
    await connectWallet();
    cdpMocks.listSmartAccounts.mockResolvedValue({
      accounts: [{ address: OPERATOR_ADDRESS.toUpperCase() }],
    });
    const { operatorWalletIsManaged } = await import("./walletFunding.js");
    expect(await operatorWalletIsManaged()).toBe(true);
  });

  it("does not claim a wallet is grantable when CDP could not be reached", async () => {
    await connectWallet();
    cdpMocks.listSmartAccounts.mockRejectedValue(new Error("network down"));
    const { operatorWalletIsManaged } = await import("./walletFunding.js");
    // Offering a grant form that cannot work is worse than saying it cannot.
    expect(await operatorWalletIsManaged()).toBe(false);
  });

  it("grants to Jarvis's own spender and nothing else", async () => {
    await connectWallet();
    mockSpender();
    cdpMocks.createSpendPermission.mockResolvedValue({ userOpHash: "0xuserop" });
    const { grantSpendPermission } = await import("./walletFunding.js");

    const result = await grantSpendPermission({
      allowanceMinor: 50_000_000,
      periodInDays: 7,
      expiresInDays: 365,
    });

    expect(result.userOpHash).toBe("0xuserop");
    const sent = cdpMocks.createSpendPermission.mock.calls[0][0];
    expect(sent.spendPermission.spender).toBe(SPENDER_ADDRESS);
    expect(sent.spendPermission.account).toBe(OPERATOR_ADDRESS);
    expect(sent.spendPermission.allowance).toBe(50_000_000n);
    expect(sent.spendPermission.token).toBe("usdc");
    expect(sent.network).toBe("base");
  });

  it("refuses an allowance that is not a positive whole number", async () => {
    await connectWallet();
    mockSpender();
    const { grantSpendPermission } = await import("./walletFunding.js");
    for (const allowanceMinor of [0, -1, 1.5]) {
      await expect(
        grantSpendPermission({ allowanceMinor, periodInDays: 7, expiresInDays: 365 })
      ).rejects.toThrow(/positive whole number/i);
    }
    expect(cdpMocks.createSpendPermission).not.toHaveBeenCalled();
  });

  it("refuses an expiry inside the first period", async () => {
    await connectWallet();
    mockSpender();
    const { grantSpendPermission } = await import("./walletFunding.js");
    // Expiring before the allowance can reset makes "$50 a week" really mean
    // "$50, once" — a limit that reads as recurring but is not.
    await expect(
      grantSpendPermission({ allowanceMinor: 1_000_000, periodInDays: 30, expiresInDays: 7 })
    ).rejects.toThrow(/at least one full period/i);
    expect(cdpMocks.createSpendPermission).not.toHaveBeenCalled();
  });

  it("will not revoke a permission granted to someone else", async () => {
    await connectWallet();
    mockSpender();
    cdpMocks.listSpendPermissions.mockResolvedValue({
      spendPermissions: [fakePermission({ spender: "0x8888888888888888888888888888888888888888" })],
    });
    const { revokeSpendPermission } = await import("./walletFunding.js");
    await expect(revokeSpendPermission("0xhash1")).rejects.toThrow(/not granted to Jarvis/i);
    expect(cdpMocks.revokeSpendPermission).not.toHaveBeenCalled();
  });

  it("revokes one of Jarvis's own permissions", async () => {
    await connectWallet();
    mockSpender();
    cdpMocks.listSpendPermissions.mockResolvedValue({ spendPermissions: [fakePermission()] });
    cdpMocks.revokeSpendPermission.mockResolvedValue({ userOpHash: "0xrevoke" });
    const { revokeSpendPermission } = await import("./walletFunding.js");

    await revokeSpendPermission("0xhash1");
    expect(cdpMocks.revokeSpendPermission).toHaveBeenCalledWith(
      expect.objectContaining({ address: OPERATOR_ADDRESS, permissionHash: "0xhash1", network: "base" })
    );
  });

  it("reports a hash it cannot find rather than revoking blindly", async () => {
    await connectWallet();
    mockSpender();
    cdpMocks.listSpendPermissions.mockResolvedValue({ spendPermissions: [] });
    const { revokeSpendPermission } = await import("./walletFunding.js");
    await expect(revokeSpendPermission("0xmissing")).rejects.toThrow(/No such spend permission/i);
  });
});

describe("drawing from the wallet", () => {
  beforeEach(() => {
    Object.values(cdpMocks).forEach((mock) => mock.mockReset());
  });

  it("says there is nothing to draw from before a permission exists", async () => {
    await connectWallet();
    mockSpender();
    cdpMocks.listSpendPermissions.mockResolvedValue({ spendPermissions: [] });
    const { drawFromWallet } = await import("./walletFunding.js");
    await expect(drawFromWallet({ purposeLabel: "Console", amountMinor: 1_000_000 })).rejects.toThrow(
      /No spend permission has been granted/i
    );
    expect(cdpMocks.useSpendPermission).not.toHaveBeenCalled();
  });

  it("refuses when every permission has expired, without paying gas to find out", async () => {
    await connectWallet();
    mockSpender();
    const past = Math.floor(Date.now() / 1000) - 60;
    cdpMocks.listSpendPermissions.mockResolvedValue({
      spendPermissions: [{ ...fakePermission(), permission: { ...fakePermission().permission, end: past } }],
    });
    const { drawFromWallet } = await import("./walletFunding.js");
    await expect(drawFromWallet({ purposeLabel: "Console", amountMinor: 1_000 })).rejects.toThrow(
      /expired/i
    );
    expect(cdpMocks.useSpendPermission).not.toHaveBeenCalled();
  });

  it("picks the widest allowance, so a small permission cannot block an authorised spend", async () => {
    await connectWallet();
    mockSpender();
    const future = Math.floor(Date.now() / 1000) + 86_400;
    const small = fakePermission({ permissionHash: "0xsmall", allowance: 1_000_000n });
    const large = fakePermission({ permissionHash: "0xlarge", allowance: 90_000_000n });
    small.permission.end = future;
    large.permission.end = future;
    cdpMocks.listSpendPermissions.mockResolvedValue({ spendPermissions: [small, large] });
    cdpMocks.useSpendPermission.mockResolvedValue({ transactionHash: "0xdraw" });

    const { setEnvelope } = await import("./envelopes.js");
    setEnvelope({ rail: "wallet", period: "day", limitMinor: 90_000_000, currency: "USDC" });

    const { drawFromWallet } = await import("./walletFunding.js");
    const spend = await drawFromWallet({ purposeLabel: "Console", amountMinor: 50_000_000 });

    expect(spend.txHash).toBe("0xdraw");
    expect(cdpMocks.useSpendPermission).toHaveBeenCalledWith(
      expect.objectContaining({ value: 50_000_000n })
    );
  });

  it("is still stopped by the daily envelope, before the chain is touched", async () => {
    await connectWallet();
    mockSpender();
    const future = Math.floor(Date.now() / 1000) + 86_400;
    const permission = fakePermission({ allowance: 90_000_000n });
    permission.permission.end = future;
    cdpMocks.listSpendPermissions.mockResolvedValue({ spendPermissions: [permission] });

    const { setEnvelope } = await import("./envelopes.js");
    setEnvelope({ rail: "wallet", period: "day", limitMinor: 2_000_000, currency: "USDC" });

    const { drawFromWallet } = await import("./walletFunding.js");
    // The on-chain allowance would happily permit this; the operator's own
    // daily limit is the tighter of the two and has to win.
    await expect(
      drawFromWallet({ purposeLabel: "Too much", amountMinor: 50_000_000 })
    ).rejects.toThrow();
    expect(cdpMocks.useSpendPermission).not.toHaveBeenCalled();
  });
});
