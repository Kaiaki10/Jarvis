import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let folder: string;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-actions-"));
  process.env.JARVIS_DB_PATH = join(root, "test.db");
  process.env.JARVIS_KEY_PATH = join(root, "test.key");

  folder = join(root, "images");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "photo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));

  const { updateSettings } = await import("../db/repo.js");
  updateSettings({ imagesFolder: folder });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const creds = { botToken: "xoxb-test" };

describe("sendDiscordMessage", () => {
  it("sends a plain JSON body when no image is given", async () => {
    const { sendDiscordMessage } = await import("./actions.js");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await sendDiscordMessage(creds, "12345", "hello");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.com/api/v10/channels/12345/messages");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Authorization).toBe("Bot xoxb-test");
    expect(JSON.parse(init.body)).toEqual({ content: "hello" });
  });

  it("sends a payload_json + files[0] multipart body when an image is given", async () => {
    const { sendDiscordMessage } = await import("./actions.js");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await sendDiscordMessage(creds, "12345", "hello", "photo.png");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Content-Type"]).toBeUndefined(); // fetch sets the multipart boundary itself
    const form = init.body as FormData;
    expect(JSON.parse(form.get("payload_json") as string)).toEqual({ content: "hello" });
    const file = form.get("files[0]") as File;
    expect(file.name).toBe("photo.png");
    expect(file.type).toBe("image/png");
  });

  it("rejects without calling fetch for a filename outside the images folder", async () => {
    const { sendDiscordMessage } = await import("./actions.js");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendDiscordMessage(creds, "12345", "hello", "../secret.png")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("uploadImageToSlack", () => {
  function fetchSequence(...responses: unknown[]) {
    const fetchMock = vi.fn();
    for (const response of responses) fetchMock.mockResolvedValueOnce(response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("reserves an upload slot, PUTs the bytes, then completes the upload with the channel and caption", async () => {
    const { uploadImageToSlack } = await import("./actions.js");
    const fetchMock = fetchSequence(
      { ok: true, json: async () => ({ ok: true, upload_url: "https://files.slack.com/upload/v1/abc", file_id: "F123" }) },
      { ok: true },
      { ok: true, json: async () => ({ ok: true }) }
    );

    await uploadImageToSlack(creds, "photo.png", "C0123AB4CDE", "here's the image");

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [urlStep, urlInit] = fetchMock.mock.calls[0];
    expect(urlStep).toBe("https://slack.com/api/files.getUploadURLExternal");
    const urlForm = urlInit.body as FormData;
    expect(urlForm.get("filename")).toBe("photo.png");
    expect(urlForm.get("length")).toBe("7"); // the fixture photo.png is 7 bytes

    const [putUrl, putInit] = fetchMock.mock.calls[1];
    expect(putUrl).toBe("https://files.slack.com/upload/v1/abc");
    expect(putInit.headers["Content-Type"]).toBe("application/octet-stream");

    const [completeStep, completeInit] = fetchMock.mock.calls[2];
    expect(completeStep).toBe("https://slack.com/api/files.completeUploadExternal");
    const completeForm = completeInit.body as FormData;
    expect(JSON.parse(completeForm.get("files") as string)).toEqual([{ id: "F123", title: "photo.png" }]);
    expect(completeForm.get("channel_id")).toBe("C0123AB4CDE");
    expect(completeForm.get("initial_comment")).toBe("here's the image");
  });

  it("throws with Slack's error when the upload URL request is refused", async () => {
    const { uploadImageToSlack } = await import("./actions.js");
    fetchSequence({ ok: true, json: async () => ({ ok: false, error: "missing_scope" }) });

    await expect(
      uploadImageToSlack(creds, "photo.png", "C0123AB4CDE", "caption")
    ).rejects.toThrow(/missing_scope/);
  });

  it("throws when the raw byte upload is rejected", async () => {
    const { uploadImageToSlack } = await import("./actions.js");
    fetchSequence(
      { ok: true, json: async () => ({ ok: true, upload_url: "https://files.slack.com/upload/v1/abc", file_id: "F123" }) },
      { ok: false, status: 400 }
    );

    await expect(
      uploadImageToSlack(creds, "photo.png", "C0123AB4CDE", "caption")
    ).rejects.toThrow(/400/);
  });

  it("throws with Slack's error when completing the upload is refused", async () => {
    const { uploadImageToSlack } = await import("./actions.js");
    fetchSequence(
      { ok: true, json: async () => ({ ok: true, upload_url: "https://files.slack.com/upload/v1/abc", file_id: "F123" }) },
      { ok: true },
      { ok: true, json: async () => ({ ok: false, error: "channel_not_found" }) }
    );

    await expect(
      uploadImageToSlack(creds, "photo.png", "C0123AB4CDE", "caption")
    ).rejects.toThrow(/channel_not_found/);
  });

  it("rejects without calling fetch for a filename outside the images folder", async () => {
    const { uploadImageToSlack } = await import("./actions.js");
    const fetchMock = fetchSequence();

    await expect(
      uploadImageToSlack(creds, "../secret.png", "C0123AB4CDE", "caption")
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
