import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowOverview, ContentItemRecord } from "@jarvis/shared";

const overview = vi.hoisted(() => ({ current: null as WorkflowOverview | null }));

vi.mock("@/lib/store", () => ({
  useWorkflows: () => ({ overview: overview.current, refresh: vi.fn() }),
}));

import { SocialPosts } from "./SocialPosts";

function item(patch: Partial<ContentItemRecord> & { id: string }): ContentItemRecord {
  return {
    workflowId: "c1",
    title: `Post ${patch.id}`,
    body: "body text",
    format: "social_post",
    channel: "x",
    status: "draft",
    scheduledFor: null,
    publishedAt: null,
    performanceSummary: null,
    characterVersion: null,
    sessionId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...patch,
  };
}

function setOverview(content: ContentItemRecord[], publicationRuns: WorkflowOverview["publicationRuns"] = []) {
  overview.current = {
    workflows: [
      {
        id: "c1",
        name: "Launch week",
      } as WorkflowOverview["workflows"][number],
    ],
    content,
    generationRuns: [],
    publicationRuns,
    accounts: [],
    characters: [],
    metricCounts: {},
    insightCounts: {}, adCampaignCounts: {},
  };
}

describe("SocialPosts", () => {
  it("says so plainly when Jarvis has written nothing", () => {
    setOverview([]);
    render(<SocialPosts />);
    expect(screen.getByText(/hasn't written any content yet/i)).toBeInTheDocument();
  });

  it("renders each post with its campaign and stage", () => {
    setOverview([item({ id: "a", title: "Hello world", status: "published", publishedAt: "2026-08-02T10:00:00.000Z" })]);
    render(<SocialPosts />);

    expect(screen.getByText("Hello world")).toBeInTheDocument();
    expect(screen.getByText("published")).toBeInTheDocument();
    expect(screen.getByText("Launch week")).toBeInTheDocument();
  });

  it("filters by stage without losing the others from the data", () => {
    setOverview([
      item({ id: "a", title: "A draft", status: "draft" }),
      item({ id: "b", title: "A published one", status: "published" }),
    ]);
    render(<SocialPosts />);

    expect(screen.getByText("A draft")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Published" }));

    expect(screen.queryByText("A draft")).not.toBeInTheDocument();
    expect(screen.getByText("A published one")).toBeInTheDocument();
  });

  it("offers only channels that actually have posts behind them", () => {
    setOverview([item({ id: "a", channel: "x" }), item({ id: "b", channel: "blog" })]);
    render(<SocialPosts />);

    expect(screen.getByRole("button", { name: "X" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Blog" })).toBeInTheDocument();
    // LinkedIn is a valid channel in the type but has nothing behind it here.
    expect(screen.queryByRole("button", { name: "LinkedIn" })).not.toBeInTheDocument();
  });

  it("shows where a post actually went, from the publication ledger", () => {
    setOverview(
      [item({ id: "a", status: "published" })],
      [
        {
          id: "r1",
          contentItemId: "a",
          sessionId: "s1",
          platformId: "x",
          externalPostId: "1957000000000000001",
          status: "published",
          errorMessage: null,
          createdAt: "2026-08-02T10:00:00.000Z",
          completedAt: "2026-08-02T10:00:01.000Z",
        },
      ]
    );
    render(<SocialPosts />);
    expect(screen.getByText("via x")).toBeInTheDocument();
  });

  it("ignores a publication run that failed, rather than claiming it published", () => {
    setOverview(
      [item({ id: "a", status: "draft" })],
      [
        {
          id: "r1",
          contentItemId: "a",
          sessionId: "s1",
          platformId: "x",
          externalPostId: null,
          status: "failed",
          errorMessage: "rate limited",
          createdAt: "2026-08-02T10:00:00.000Z",
          completedAt: null,
        },
      ]
    );
    render(<SocialPosts />);
    expect(screen.queryByText("via x")).not.toBeInTheDocument();
  });

  it("puts the most recent post first", () => {
    setOverview([
      item({ id: "old", title: "Older", status: "published", publishedAt: "2026-08-01T00:00:00.000Z" }),
      item({ id: "new", title: "Newer", status: "published", publishedAt: "2026-08-05T00:00:00.000Z" }),
    ]);
    render(<SocialPosts />);

    const titles = screen.getAllByText(/Older|Newer/).map((el) => el.textContent);
    expect(titles[0]).toBe("Newer");
  });
});
