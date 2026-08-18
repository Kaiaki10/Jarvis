import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from "node:crypto";

/**
 * Passphrase-protected export of stored credentials.
 *
 * `jarvis.key` is deliberately machine-local, which means losing it destroys every
 * stored credential with no recovery path. Copying that key around would just spread
 * the problem, so a backup is re-encrypted under a key derived from a passphrase the
 * user knows. The result is portable and safe to keep anywhere the passphrase isn't —
 * a password manager, cloud storage, another machine.
 */

const ALGORITHM = "aes-256-gcm";
const KDF_N = 1 << 15; // ~32 MB, deliberately slow to brute force
const KDF_R = 8;
const KDF_P = 1;
const KEY_LEN = 32;

export const MIN_PASSPHRASE_LENGTH = 12;

export interface BackupBundle {
  format: "jarvis-credential-backup";
  version: 1;
  createdAt: string;
  kdf: { name: "scrypt"; N: number; r: number; p: number; salt: string };
  iv: string;
  tag: string;
  ciphertext: string;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase.normalize("NFKC"), salt, KEY_LEN, {
    N: KDF_N,
    r: KDF_R,
    p: KDF_P,
    maxmem: 128 * KDF_N * KDF_R * 2,
  });
}

export function createBackup(payload: unknown, passphrase: string): BackupBundle {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(
      `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters. This file is the only thing protecting your credentials.`
    );
  }

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), "utf-8")),
    cipher.final(),
  ]);

  return {
    format: "jarvis-credential-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    kdf: { name: "scrypt", N: KDF_N, r: KDF_R, p: KDF_P, salt: salt.toString("base64") },
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function restoreBackup<T>(bundle: BackupBundle, passphrase: string): T {
  if (bundle?.format !== "jarvis-credential-backup") {
    throw new Error("This does not look like a Jarvis credential backup file.");
  }
  if (bundle.version !== 1) {
    throw new Error(`Unsupported backup version: ${bundle.version}`);
  }

  // Honour the KDF parameters recorded in the file, so older backups still open
  // if the defaults are ever changed.
  const salt = Buffer.from(bundle.kdf.salt, "base64");
  const key = scryptSync(passphrase.normalize("NFKC"), salt, KEY_LEN, {
    N: bundle.kdf.N,
    r: bundle.kdf.r,
    p: bundle.kdf.p,
    maxmem: 128 * bundle.kdf.N * bundle.kdf.r * 2,
  });

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(bundle.iv, "base64"));
  decipher.setAuthTag(Buffer.from(bundle.tag, "base64"));

  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(bundle.ciphertext, "base64")),
      decipher.final(),
    ]);
  } catch {
    // GCM auth failure is indistinguishable from a wrong passphrase, and saying so
    // is more useful than surfacing a crypto error.
    throw new Error("Wrong passphrase, or the backup file has been modified.");
  }

  return JSON.parse(plaintext.toString("utf-8")) as T;
}

/** Constant-time compare, for anywhere a secret is checked against user input. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
