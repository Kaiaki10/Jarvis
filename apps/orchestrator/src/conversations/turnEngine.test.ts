import { describe, expect, it } from "vitest";
import {
  buildTurnPrompt,
  chooseNextSpeaker,
  isConclusion,
  parseMention,
  shouldStop,
} from "./turnEngine.js";

const ALICE = { agentId: "a", name: "Alice", position: 0 };
const BOB = { agentId: "b", name: "Bob", position: 1 };
const CARA = { agentId: "c", name: "Cara", position: 2 };
const ROOM = [ALICE, BOB, CARA];

describe("parseMention", () => {
  it("finds an agent addressed by @name", () => {
    expect(parseMention("What do you think, @Bob?", ROOM)).toBe("b");
    expect(parseMention("@cara take this one", ROOM)).toBe("c");
  });

  it("ignores a name that is merely discussed", () => {
    // Otherwise talking about an absent agent silently hands it the floor.
    expect(parseMention("Bob already covered that.", ROOM)).toBeNull();
  });

  it("does not match a name that is a prefix of another", () => {
    const room = [{ agentId: "x", name: "Ana", position: 0 }, { agentId: "y", name: "Anabel", position: 1 }];
    expect(parseMention("@Anabel please continue", room)).toBe("y");
  });

  it("prefers the longest matching name", () => {
    const room = [{ agentId: "x", name: "Atlas", position: 0 }, { agentId: "y", name: "Atlas Prime", position: 1 }];
    expect(parseMention("@Atlas Prime, your turn", room)).toBe("y");
  });

  it("returns null when nobody is addressed", () => {
    expect(parseMention("A general observation.", ROOM)).toBeNull();
  });
});

describe("chooseNextSpeaker", () => {
  it("starts with the first participant", () => {
    expect(chooseNextSpeaker("", ROOM, null)).toBe("a");
  });

  it("passes the floor to whoever was addressed", () => {
    expect(chooseNextSpeaker("@Cara what do you think?", ROOM, "a")).toBe("c");
  });

  it("falls back to round-robin", () => {
    expect(chooseNextSpeaker("No mention here.", ROOM, "a")).toBe("b");
    expect(chooseNextSpeaker("No mention here.", ROOM, "b")).toBe("c");
    // Wraps rather than ending the room.
    expect(chooseNextSpeaker("No mention here.", ROOM, "c")).toBe("a");
  });

  it("never hands an agent the floor by its own mention", () => {
    // An agent writing its own name would otherwise loop on itself forever.
    expect(chooseNextSpeaker("As @Alice I would say...", ROOM, "a")).toBe("b");
  });

  it("recovers if the last speaker has left the room", () => {
    expect(chooseNextSpeaker("anything", ROOM, "gone")).toBe("a");
  });

  it("returns null for an empty room", () => {
    expect(chooseNextSpeaker("anything", [], null)).toBeNull();
  });
});

describe("shouldStop", () => {
  const base = {
    status: "running",
    turnsUsed: 0,
    turnCap: 10,
    budgetSeconds: 600,
    startedAt: "2026-01-01T00:00:00.000Z",
    now: new Date("2026-01-01T00:01:00.000Z").getTime(),
  };

  it("lets a fresh room continue", () => {
    expect(shouldStop(base).stop).toBe(false);
  });

  it("stops at the turn cap, before spending another turn", () => {
    const result = shouldStop({ ...base, turnsUsed: 10 });
    expect(result.stop).toBe(true);
    expect(result).toHaveProperty("reason", expect.stringContaining("turn limit"));
  });

  it("stops once the time budget is spent", () => {
    const result = shouldStop({
      ...base,
      now: new Date("2026-01-01T00:11:00.000Z").getTime(),
    });
    expect(result.stop).toBe(true);
    expect(result).toHaveProperty("reason", expect.stringContaining("time budget"));
  });

  it("stops immediately when a human stopped it", () => {
    expect(shouldStop({ ...base, status: "stopped" }).stop).toBe(true);
  });

  it("does not apply the time budget before the room has started", () => {
    expect(shouldStop({ ...base, startedAt: null }).stop).toBe(false);
  });
});

describe("buildTurnPrompt", () => {
  it("tells the agent who it is and who else is present", () => {
    const prompt = buildTurnPrompt({
      speakerName: "Alice",
      others: ["Bob"],
      topic: "Pricing",
      transcript: [{ speakerName: "Bob", body: "I think we go higher." }],
      turnsRemaining: 4,
    });
    // Without its own name an agent cannot tell its past turns from the others'
    // and begins replying to itself.
    expect(prompt).toContain("You are Alice");
    expect(prompt).toContain("Bob: I think we go higher.");
    expect(prompt).toContain("Pricing");
    expect(prompt).toContain("4 turns remain");
  });

  it("reads sensibly with no transcript yet", () => {
    const prompt = buildTurnPrompt({
      speakerName: "Alice", others: ["Bob"], topic: "Kickoff", transcript: [], turnsRemaining: 6,
    });
    expect(prompt).not.toContain("Conversation so far");
  });
});

describe("isConclusion", () => {
  it("recognises a deliberate ending", () => {
    expect(isConclusion("We agree on the plan.\nDONE")).toBe(true);
    expect(isConclusion("We agree.\n\ndone")).toBe(true);
  });

  it("does not end on the word appearing mid-sentence", () => {
    expect(isConclusion("I am done thinking about it, but one more point.")).toBe(false);
    expect(isConclusion("DONE is what we say when finished, and we are not.")).toBe(false);
  });
});
