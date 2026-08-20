import { randomBytes, createCipheriv, createDecipheriv, createHmac } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH =
  process.env.JARVIS_KEY_PATH ?? join(__dirname, "..", "..", "jarvis.key");

const ALGORITHM = "aes-256-gcm";

/**
 * Local encryption key, generated once on first use.
 *
 * This keeps platform credentials from sitting in the SQLite file as plaintext,
 * so a stray backup, screen share, or accidental commit doesn't leak them. It is
 * NOT protection against someone who already has read access to this machine —
 * the key lives beside the database by necessity, since the orchestrator has to
 * decrypt unattended for scheduled runs.
 */
function loadKey(): Buffer {
  if (existsSync(KEY_PATH)) {
    return Buffer.from(readFileSync(KEY_PATH, "utf-8").trim(), "base64");
  }
  const key = randomBytes(32);
  writeFileSync(KEY_PATH, key.toString("base64"), { mode: 0o600 });
  try {
    chmodSync(KEY_PATH, 0o600);
  } catch {
    // Best effort — POSIX modes are advisory on Windows.
  }
  return key;
}

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (!cachedKey) cachedKey = loadKey();
  return cachedKey;
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf-8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(
    ":"
  );
}

export function decryptJson<T>(blob: string): T {
  const [ivB64, tagB64, dataB64] = blob.split(":");
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf-8")) as T;
}

/**
 * A purpose-specific subkey derived from the local encryption key. A new
 * feature that needs its own signing key (e.g. one-tap push approval links)
 * gets one without a new key file to lose — but reusing the raw AES key
 * directly across purposes would weaken it, so this derives a distinct key
 * per purpose instead of handing out `key()` itself.
 */
export function deriveKey(purpose: string): Buffer {
  return createHmac("sha256", key()).update(purpose).digest();
}

/** Last four characters only, so the UI can show which value is stored. */
export function maskValue(value: string): string {
  if (!value) return "";
  const tail = value.slice(-4);
  return `••••${tail}`;
}
