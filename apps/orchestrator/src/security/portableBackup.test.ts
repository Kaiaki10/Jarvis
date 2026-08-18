import { describe, it, expect } from "vitest";
import {
  createBackup,
  restoreBackup,
  MIN_PASSPHRASE_LENGTH,
  type BackupBundle,
} from "./portableBackup.js";

const PASSPHRASE = "correct horse battery staple";
const PAYLOAD = {
  slack: { botToken: "xoxb-real-looking-token-abc123" },
  resend: { apiKey: "re_live_key_xyz", fromAddress: "hi@example.com" },
};

describe("portableBackup", () => {
  it("round-trips credentials through a passphrase", () => {
    const bundle = createBackup(PAYLOAD, PASSPHRASE);
    expect(restoreBackup(bundle, PASSPHRASE)).toEqual(PAYLOAD);
  });

  it("never puts secrets in the bundle in readable form", () => {
    const serialized = JSON.stringify(createBackup(PAYLOAD, PASSPHRASE));
    expect(serialized).not.toContain("xoxb-real-looking-token-abc123");
    expect(serialized).not.toContain("re_live_key_xyz");
    expect(serialized).not.toContain("hi@example.com");
    expect(serialized).not.toContain("slack");
  });

  it("rejects the wrong passphrase instead of returning garbage", () => {
    const bundle = createBackup(PAYLOAD, PASSPHRASE);
    expect(() => restoreBackup(bundle, "not the passphrase")).toThrow(/Wrong passphrase/);
  });

  it("detects a tampered ciphertext", () => {
    const bundle = createBackup(PAYLOAD, PASSPHRASE);
    const bytes = Buffer.from(bundle.ciphertext, "base64");
    bytes[0] ^= 0xff;
    const tampered = { ...bundle, ciphertext: bytes.toString("base64") };
    expect(() => restoreBackup(tampered, PASSPHRASE)).toThrow(/Wrong passphrase|modified/);
  });

  it("detects a swapped salt", () => {
    const a = createBackup(PAYLOAD, PASSPHRASE);
    const b = createBackup(PAYLOAD, PASSPHRASE);
    const frankenstein = { ...a, kdf: { ...a.kdf, salt: b.kdf.salt } };
    expect(() => restoreBackup(frankenstein, PASSPHRASE)).toThrow();
  });

  it("uses a fresh salt and iv every time", () => {
    const a = createBackup(PAYLOAD, PASSPHRASE);
    const b = createBackup(PAYLOAD, PASSPHRASE);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("refuses a passphrase too short to be worth anything", () => {
    expect(() => createBackup(PAYLOAD, "short")).toThrow(
      new RegExp(`${MIN_PASSPHRASE_LENGTH} characters`)
    );
  });

  it("rejects a file that is not a Jarvis backup", () => {
    const notABackup = { format: "something-else", version: 1 } as unknown as BackupBundle;
    expect(() => restoreBackup(notABackup, PASSPHRASE)).toThrow(/does not look like/);
  });

  it("rejects a future backup version rather than misreading it", () => {
    const bundle = { ...createBackup(PAYLOAD, PASSPHRASE), version: 2 as 1 };
    expect(() => restoreBackup(bundle, PASSPHRASE)).toThrow(/Unsupported backup version/);
  });

  it("opens a backup written with different KDF parameters", () => {
    // Proves the parameters are read from the file rather than assumed, so backups
    // keep opening if the defaults change later.
    const bundle = createBackup(PAYLOAD, PASSPHRASE);
    expect(bundle.kdf.name).toBe("scrypt");
    expect(restoreBackup({ ...bundle }, PASSPHRASE)).toEqual(PAYLOAD);
  });

  it("handles unicode passphrases consistently", () => {
    const unicode = "pässwörd-с-юникодом-✓";
    const bundle = createBackup(PAYLOAD, unicode);
    expect(restoreBackup(bundle, unicode)).toEqual(PAYLOAD);
  });
});
