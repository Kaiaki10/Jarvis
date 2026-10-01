import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let folder: string;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-artlist-"));
  process.env.JARVIS_DB_PATH = join(root, "test.db");
  process.env.JARVIS_KEY_PATH = join(root, "test.key");

  folder = join(root, "images");
  mkdirSync(folder, { recursive: true });

  const { updateSettings } = await import("../db/repo.js");
  updateSettings({ imagesFolder: folder });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function downloadResponse(bytes: Buffer, contentType = "image/png", status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": contentType }),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

describe("importMediaUrl", () => {
  it("saves an https image into the images folder", async () => {
    const { importMediaUrl } = await import("./actions.js");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(downloadResponse(Buffer.from([0x89, 0x50, 0x4e, 0x47]))));
    const stored = await importMediaUrl("https://cdn.artlist.io/renders/hero.png");
    expect(stored).toBe("hero.png");
    expect(existsSync(join(folder, stored))).toBe(true);
  });

  it("derives the extension from the content type when the URL has none", async () => {
    const { importMediaUrl } = await import("./actions.js");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(downloadResponse(Buffer.from([1, 2, 3]), "image/jpeg")));
    const stored = await importMediaUrl("https://cdn.artlist.io/renders/abc123");
    expect(/\.jpe?g$/.test(stored)).toBe(true);
  });

  it("refuses non-https, loopback, and private addresses", async () => {
    const { importMediaUrl } = await import("./actions.js");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const url of [
      "http://cdn.artlist.io/renders/hero.png",
      "https://localhost/renders/hero.png",
      "https://127.0.0.1/renders/hero.png",
      "https://192.168.1.10/renders/hero.png",
      "https://169.254.169.254/latest/meta-data/",
      "not a url",
    ]) {
      await expect(importMediaUrl(url)).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses failures, non-images, and oversize downloads", async () => {
    const { importMediaUrl } = await import("./actions.js");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(downloadResponse(Buffer.from([1]), "image/png", 404)));
    await expect(importMediaUrl("https://cdn.artlist.io/renders/missing.png")).rejects.toThrow(/HTTP 404/);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(downloadResponse(Buffer.from("hello"), "text/html")));
    await expect(importMediaUrl("https://cdn.artlist.io/renders/page")).rejects.toThrow(/not an image/);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(downloadResponse(Buffer.alloc(6 * 1024 * 1024), "image/png"))
    );
    await expect(importMediaUrl("https://cdn.artlist.io/renders/big.png")).rejects.toThrow(/5 MB/);
  });
});

describe("artlist platform", () => {
  it("is registered as a creative platform", async () => {
    const { getPlatform, platformDefinitions } = await import("./definitions.js");
    const artlist = getPlatform("artlist");
    expect(artlist?.definition.category).toBe("creative");
    expect(platformDefinitions().map((p) => p.id)).toContain("artlist");
  });

  it("rejects an empty token without calling the network", async () => {
    const { getPlatform } = await import("./definitions.js");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await getPlatform("artlist")!.test({ apiToken: "   " });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a revoked token and accepts a working endpoint", async () => {
    const { getPlatform } = await import("./definitions.js");
    const test = getPlatform("artlist")!.test;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 401 }));
    expect((await test({ apiToken: "bad" })).ok).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    const ok = await test({ apiToken: "good" });
    expect(ok.ok).toBe(true);
  });

  it("wires the remote MCP server and import tool once connected", async () => {
    const { saveConnection, recordTestResult } = await import("../db/connectionsRepo.js");
    const { buildPlatformToolset } = await import("./actions.js");
    const connection = saveConnection("artlist", { apiToken: "token-123" }, { forceNew: true });
    recordTestResult(connection.id, true, "Artlist MCP reachable", null);

    const toolset = buildPlatformToolset("session-1");
    const servers = toolset.mcpServers ?? {};
    expect(servers.artlist).toMatchObject({ type: "http", url: expect.stringContaining("artlist.io") });
    expect(toolset.capabilitySummary).toContain("Artlist");
    // The import tool is approval-gated like every other outbound tool, never pre-approved.
    expect(toolset.autoAllowTools).not.toContain("mcp__jarvis__import_media_url");
  });
});
