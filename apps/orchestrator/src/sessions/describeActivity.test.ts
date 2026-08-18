import { describe, it, expect } from "vitest";
import { describeActivity, extractSummary } from "./describeActivity.js";

function assistant(content: unknown) {
  return { type: "assistant", message: { content } };
}

describe("describeActivity", () => {
  it("names the file being edited rather than its full path", () => {
    expect(
      describeActivity(
        assistant([
          { type: "tool_use", name: "Edit", input: { file_path: "C:/a/b/store.tsx" } },
        ])
      )
    ).toBe("Editing store.tsx");
  });

  it("shows the command being run", () => {
    expect(
      describeActivity(
        assistant([{ type: "tool_use", name: "Bash", input: { command: "npm test" } }])
      )
    ).toBe("Running npm test");
  });

  it("keeps a long command to one line", () => {
    const activity = describeActivity(
      assistant([
        {
          type: "tool_use",
          name: "Bash",
          input: { command: "a".repeat(200) + "\nsecond line" },
        },
      ])
    );
    expect(activity).not.toContain("\n");
    expect(activity!.length).toBeLessThan(70);
  });

  it("describes outbound platform actions specifically", () => {
    expect(
      describeActivity(
        assistant([{ type: "tool_use", name: "mcp__jarvis__post_to_x", input: {} }])
      )
    ).toBe("Preparing to post to x");
  });

  it("prefers the tool call over the sentence introducing it", () => {
    expect(
      describeActivity(
        assistant([
          { type: "text", text: "Let me check the tests." },
          { type: "tool_use", name: "Bash", input: { command: "npm test" } },
        ])
      )
    ).toBe("Running npm test");
  });

  it("falls back to text when there is no tool call", () => {
    expect(describeActivity(assistant([{ type: "text", text: "Reviewing the code." }]))).toBe(
      "Reviewing the code."
    );
  });

  it("returns null for messages that say nothing worth showing", () => {
    // Returning null leaves the previous activity on screen instead of flickering.
    expect(describeActivity(assistant([{ type: "text", text: "   " }]))).toBeNull();
    expect(describeActivity({ type: "result" })).toBeNull();
    expect(describeActivity(assistant("not an array"))).toBeNull();
  });
});

describe("extractSummary", () => {
  it("keeps a short single-line reply whole", () => {
    expect(extractSummary("Added EventSource reconnection with backoff.")).toBe(
      "Added EventSource reconnection with backoff."
    );
  });

  it("takes the opening line, not the trailing detail", () => {
    // The closing line is usually a supporting note; taking it produced summaries
    // that read as non-sequiturs.
    const reply = [
      "Fixed the duplicate detection so reposts are caught before sending.",
      "",
      "The register also documents 13 closed gaps from recent work.",
    ].join("\n");
    expect(extractSummary(reply)).toBe(
      "Fixed the duplicate detection so reposts are caught before sending."
    );
  });

  it("skips a bare heading", () => {
    expect(extractSummary("## Summary\n\nUpgraded three dev dependencies.")).toBe(
      "Upgraded three dev dependencies."
    );
    expect(extractSummary("Summary:\nUpgraded three dev dependencies.")).toBe(
      "Upgraded three dev dependencies."
    );
  });

  it("strips list and quote markers", () => {
    expect(extractSummary("- Added tests for oauth1 signing.")).toBe(
      "Added tests for oauth1 signing."
    );
  });

  it("truncates something absurdly long", () => {
    const summary = extractSummary("x".repeat(500) + "\nsecond line");
    expect(summary!.length).toBeLessThanOrEqual(300);
    expect(summary!.endsWith("…")).toBe(true);
  });

  it("returns null when there is nothing to summarise", () => {
    expect(extractSummary("")).toBeNull();
    expect(extractSummary("   \n  ")).toBeNull();
    expect(extractSummary(undefined)).toBeNull();
    expect(extractSummary(42)).toBeNull();
  });
});

describe("extractSummary — filler that looked like a summary", () => {
  it("skips a line that introduces what follows", () => {
    // Observed in a real run: the opening line was pure preamble ending in a
    // colon, which the first-line rule happily returned as the summary.
    const reply = [
      "Great! I've read GAPS.md and run the tests. Here are the results:",
      "",
      "All 105 tests pass across 10 files.",
    ].join("\n");
    expect(extractSummary(reply)).toBe("All 105 tests pass across 10 files.");
  });

  it("strips a cheerful opener but keeps the sentence", () => {
    expect(extractSummary("Perfect! Added retry logic to the scheduler.")).toBe(
      "Added retry logic to the scheduler."
    );
    expect(extractSummary("Done. Upgraded two dependencies.")).toBe(
      "Upgraded two dependencies."
    );
  });

  it("still returns something when every line ends in a colon", () => {
    expect(extractSummary("Here are the results:")).toBeNull();
  });
});
