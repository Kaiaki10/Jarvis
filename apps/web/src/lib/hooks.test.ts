import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEventRecord } from "@jarvis/shared";

vi.mock("./store", () => ({
  useSessionsList: () => ({ sessionById: new Map() }),
}));

const apiMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSessionEvents: vi.fn(),
}));

vi.mock("./api", () => ({
  api: apiMocks,
  sessionStreamUrl: vi.fn(async (id: string) => `http://test/sessions/${id}/events`),
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Array<(e: MessageEvent) => void>>();

  constructor(public readonly url: string | URL) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: (e: MessageEvent) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }

  emitData(name: string, data: unknown) {
    for (const listener of this.listeners.get(name) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }

  close() {}
}

function textDeltaEvent(seq: number, text: string): SessionEventRecord {
  return {
    id: `evt-${seq}`,
    sessionId: "s1",
    seq,
    type: "stream_event",
    payload: { event: { type: "content_block_delta", delta: { type: "text_delta", text } } },
    createdAt: new Date().toISOString(),
  } as unknown as SessionEventRecord;
}

function assistantEvent(seq: number, text: string): SessionEventRecord {
  return {
    id: `evt-${seq}`,
    sessionId: "s1",
    seq,
    type: "assistant",
    payload: { message: { role: "assistant", content: text } },
    createdAt: new Date().toISOString(),
  } as unknown as SessionEventRecord;
}

describe("useSessionStream", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    apiMocks.getSession.mockResolvedValue(null);
    apiMocks.getSessionEvents.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("never puts a streamed token into events/React state, but updates liveTextRef and notifies subscribers", async () => {
    const { useSessionStream } = await import("./hooks.js");
    const { result } = renderHook(() => useSessionStream("s1"));

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];

    const heard: string[] = [];
    act(() => {
      result.current.subscribeStreamDelta(() => heard.push(result.current.liveTextRef.current));
    });

    const eventsBefore = result.current.events;
    act(() => {
      source.emitData("session-event", textDeltaEvent(1, "Hel"));
      source.emitData("session-event", textDeltaEvent(2, "lo"));
    });

    // Same array reference: no setEventState/re-render was triggered by the tokens.
    expect(result.current.events).toBe(eventsBefore);
    expect(result.current.liveTextRef.current).toBe("Hello");
    expect(heard).toEqual(["Hel", "Hello"]);

    await waitFor(() => expect(result.current.streaming).toBe(true));
  });

  it("finalizing a turn clears the live text and appends the real event to state", async () => {
    const { useSessionStream } = await import("./hooks.js");
    const { result } = renderHook(() => useSessionStream("s1"));

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];

    act(() => {
      source.emitData("session-event", textDeltaEvent(1, "Hi"));
    });
    await waitFor(() => expect(result.current.streaming).toBe(true));

    act(() => {
      source.emitData("session-event", assistantEvent(2, "Hi"));
    });

    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(result.current.liveTextRef.current).toBe("");
    expect(result.current.events.map((e) => e.type)).toEqual(["assistant"]);
  });

  it("ignores a stream_event that arrives with an old or duplicate seq", async () => {
    const { useSessionStream } = await import("./hooks.js");
    const { result } = renderHook(() => useSessionStream("s1"));

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];

    act(() => {
      source.emitData("session-event", textDeltaEvent(5, "five"));
      source.emitData("session-event", textDeltaEvent(3, "three")); // stale, must be dropped
    });

    expect(result.current.liveTextRef.current).toBe("five");
  });
});
