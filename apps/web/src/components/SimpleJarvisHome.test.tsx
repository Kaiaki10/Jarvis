import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getChat: vi.fn(),
  sendChat: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMocks }));

vi.mock("@/lib/store", () => ({
  useAgents: () => ({ activeAgent: null }),
  useConnectionStatus: () => "connected",
  useMemories: () => ({ memories: [] }),
  useStore: () => ({ primarySessionId: null }),
}));

vi.mock("@/lib/hooks", () => ({
  useSessionStream: () => ({ session: null, events: [], refreshSession: () => {} }),
}));

// These pull in their own store/context hooks that aren't the point of this
// test — the composer's keyboard handling is.
vi.mock("@/components/ExperienceModeToggle", () => ({ ExperienceModeToggle: () => null }));
vi.mock("@/components/ClaudeUsageBadge", () => ({ ClaudeUsageBadge: () => null }));
vi.mock("@/components/SimpleConnectChips", () => ({ SimpleConnectChips: () => null }));
vi.mock("@/components/SessionTranscript", () => ({ SessionTranscript: () => null }));

import { SimpleJarvisHome } from "./SimpleJarvisHome";

beforeEach(() => {
  apiMocks.getChat.mockReset().mockResolvedValue({ session: null });
  apiMocks.sendChat.mockReset().mockResolvedValue({ sessionId: "s1", resumed: false });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
});

describe("SimpleJarvisHome keyboard shortcut", () => {
  it("sends exactly once on Ctrl+Enter while focused in the textarea", () => {
    render(<SimpleJarvisHome />);
    const textarea = screen.getByPlaceholderText(/Message/);

    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    expect(apiMocks.sendChat).toHaveBeenCalledTimes(1);
    expect(apiMocks.sendChat).toHaveBeenCalledWith("hello", "claude", "default", false);
  });

  it("still sends on Ctrl+Enter fired from elsewhere in the panel, not just the textarea", () => {
    render(<SimpleJarvisHome />);
    const textarea = screen.getByPlaceholderText(/Message/);
    fireEvent.change(textarea, { target: { value: "hello from elsewhere" } });

    const voiceButton = screen.getByRole("button", { name: /voice input/i });
    fireEvent.keyDown(voiceButton, { key: "Enter", ctrlKey: true });

    expect(apiMocks.sendChat).toHaveBeenCalledTimes(1);
  });

  it("does nothing on Ctrl+Enter with an empty draft", () => {
    render(<SimpleJarvisHome />);
    const textarea = screen.getByPlaceholderText(/Message/);

    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    expect(apiMocks.sendChat).not.toHaveBeenCalled();
  });

  it("plain Enter still sends, and Shift+Enter still inserts a newline instead", () => {
    render(<SimpleJarvisHome />);
    const textarea = screen.getByPlaceholderText(/Message/);

    fireEvent.change(textarea, { target: { value: "shift enter first" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(apiMocks.sendChat).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(apiMocks.sendChat).toHaveBeenCalledTimes(1);
  });
});
