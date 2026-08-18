import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let folder: string;
let outsideSecret: string;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-media-"));
  process.env.JARVIS_DB_PATH = join(root, "test.db");
  process.env.JARVIS_KEY_PATH = join(root, "test.key");

  folder = join(root, "images");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "photo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  writeFileSync(join(folder, "notes.txt"), "not an image");
  writeFileSync(join(folder, "empty.png"), "");

  // A sensitive file sitting next to the images folder, which nothing should reach.
  outsideSecret = join(root, "secrets.env");
  writeFileSync(outsideSecret, "API_KEY=super-secret");

  const { updateSettings } = await import("../db/repo.js");
  updateSettings({ imagesFolder: folder });
});

const load = () => import("./media.js");

describe("listImages", () => {
  it("lists images and ignores non-images and empty files", async () => {
    const { listImages } = await load();
    const names = listImages().map((i) => i.fileName);
    expect(names).toContain("photo.png");
    expect(names).not.toContain("notes.txt");
    expect(names).not.toContain("empty.png");
  });
});

describe("resolveImagePath", () => {
  it("resolves a real image in the folder", async () => {
    const { resolveImagePath } = await load();
    expect(resolveImagePath("photo.png")).toBe(join(folder, "photo.png"));
  });

  it("refuses directory traversal", async () => {
    const { resolveImagePath } = await load();
    // The filename comes from a model that may have read untrusted text, so this
    // has to be impossible by construction rather than by good behaviour.
    for (const attempt of [
      "../secrets.env",
      "..\\secrets.env",
      "../../secrets.env",
      "images/../../secrets.env",
      "./../secrets.env",
    ]) {
      expect(() => resolveImagePath(attempt)).toThrow();
    }
  });

  it("refuses absolute paths", async () => {
    const { resolveImagePath } = await load();
    expect(() => resolveImagePath(outsideSecret)).toThrow();
    expect(() => resolveImagePath("C:\\Windows\\System32\\drivers\\etc\\hosts")).toThrow();
    expect(() => resolveImagePath("/etc/passwd")).toThrow();
  });

  it("refuses a nested path even inside the folder", async () => {
    const { resolveImagePath } = await load();
    expect(() => resolveImagePath("sub/photo.png")).toThrow(/plain filename/);
  });

  it("refuses non-image extensions", async () => {
    const { resolveImagePath } = await load();
    expect(() => resolveImagePath("notes.txt")).toThrow(/not an image/);
  });

  it("refuses a file that does not exist", async () => {
    const { resolveImagePath } = await load();
    expect(() => resolveImagePath("missing.png")).toThrow(/not found/);
  });

  it("refuses an empty file", async () => {
    const { resolveImagePath } = await load();
    expect(() => resolveImagePath("empty.png")).toThrow(/empty/);
  });

  it("rejects a missing or non-string filename", async () => {
    const { resolveImagePath } = await load();
    expect(() => resolveImagePath("")).toThrow();
    expect(() => resolveImagePath(undefined as unknown as string)).toThrow();
  });
});

describe("readImage", () => {
  it("returns the bytes of a valid image", async () => {
    const { readImage } = await load();
    const { bytes } = readImage("photo.png");
    expect(bytes.length).toBe(7);
    expect(bytes[0]).toBe(0x89);
  });

  it("never returns bytes for a file outside the folder", async () => {
    const { readImage } = await load();
    expect(() => readImage("../secrets.env")).toThrow();
  });
});
