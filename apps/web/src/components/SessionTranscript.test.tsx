import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionTranscript } from "./SessionTranscript";

/** Mirrors the real contract useSessionStream hands to SessionTranscript. */
function fakeStream() {
  const liveTextRef = { current: "" };
  const listeners = new Set<() => void>();
  const subscribeStreamDelta = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const push = (text: string) => {
    liveTextRef.current += text;
    for (const listener of listeners) listener();
  };
  return { liveTextRef, subscribeStreamDelta, push, listenerCount: () => listeners.size };
}

describe("SessionTranscript live text", () => {
  it("does not render the live line while nothing is streaming", () => {
    const { liveTextRef, subscribeStreamDelta } = fakeStream();
    render(
      <SessionTranscript
        sessionId="s1"
        session={null}
        events={[]}
        refreshSession={vi.fn()}
        liveTextRef={liveTextRef}
        subscribeStreamDelta={subscribeStreamDelta}
        streaming={false}
      />
    );
    expect(screen.queryByText("▍")).not.toBeInTheDocument();
  });

  it("writes streamed tokens straight into the DOM node without a rerender", () => {
    const { liveTextRef, subscribeStreamDelta, push, listenerCount } = fakeStream();
    const { container, rerender } = render(
      <SessionTranscript
        sessionId="s1"
        session={null}
        events={[]}
        refreshSession={vi.fn()}
        liveTextRef={liveTextRef}
        subscribeStreamDelta={subscribeStreamDelta}
        streaming={true}
      />
    );
    // The one, real, low-frequency rerender: streaming flips false -> true.
    rerender(
      <SessionTranscript
        sessionId="s1"
        session={null}
        events={[]}
        refreshSession={vi.fn()}
        liveTextRef={liveTextRef}
        subscribeStreamDelta={subscribeStreamDelta}
        streaming={true}
      />
    );
    expect(listenerCount()).toBe(1);

    // Every token after this point is a direct DOM write via the subscribed
    // listener -- no further render() call, matching how the real hook drives it.
    act(() => {
      push("Hel");
      push("lo");
    });

    const bubble = container.querySelector(".animate-message-in");
    expect(bubble?.textContent).toContain("Hello");
  });

  it("unsubscribes when the component unmounts", () => {
    const { liveTextRef, subscribeStreamDelta, listenerCount } = fakeStream();
    const { unmount } = render(
      <SessionTranscript
        sessionId="s1"
        session={null}
        events={[]}
        refreshSession={vi.fn()}
        liveTextRef={liveTextRef}
        subscribeStreamDelta={subscribeStreamDelta}
        streaming={false}
      />
    );
    expect(listenerCount()).toBe(1);
    unmount();
    expect(listenerCount()).toBe(0);
  });
});
