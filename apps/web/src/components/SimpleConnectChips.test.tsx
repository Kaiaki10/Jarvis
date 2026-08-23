import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  platforms: [] as Array<{ id: string; category: string }>,
  connections: [] as Array<{ platformId: string; status: string }>,
}));

vi.mock("@/lib/store", () => ({
  useConnections: () => state,
}));

import { SimpleConnectChips } from "./SimpleConnectChips";

beforeEach(() => {
  state.platforms = [
    { id: "x", category: "social" },
    { id: "coinbase", category: "finance" },
  ];
  state.connections = [];
});

describe("SimpleConnectChips", () => {
  it("invites you to connect when nothing is", () => {
    render(<SimpleConnectChips />);
    expect(screen.getByRole("link", { name: /Connect wallet/ })).toHaveAttribute(
      "href",
      "/under-the-hood/connections/coinbase"
    );
    expect(screen.getByRole("link", { name: /Connect social/ })).toBeInTheDocument();
  });

  it("stops asking once connected", () => {
    state.connections = [
      { platformId: "coinbase", status: "connected" },
      { platformId: "x", status: "connected" },
    ];
    render(<SimpleConnectChips />);
    expect(screen.getByRole("link", { name: /Wallet ready/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Social connected/ })).toBeInTheDocument();
    expect(screen.queryByText(/Connect wallet/)).not.toBeInTheDocument();
  });

  it("does not count an untested account as connected", () => {
    // A saved credential is not a working one — the wizard stores it as
    // `not_connected` until its test passes, and claiming otherwise here would
    // tell you Jarvis can post when it cannot.
    state.connections = [{ platformId: "x", status: "not_connected" }];
    render(<SimpleConnectChips />);
    expect(screen.getByRole("link", { name: /Connect social/ })).toBeInTheDocument();
  });

  it("counts multiple social accounts", () => {
    state.connections = [
      { platformId: "x", status: "connected" },
      { platformId: "x", status: "connected" },
    ];
    render(<SimpleConnectChips />);
    expect(screen.getByRole("link", { name: /2 accounts/ })).toBeInTheDocument();
  });

  it("points at the category once there is more than one social platform", () => {
    state.platforms = [
      { id: "x", category: "social" },
      { id: "linkedin", category: "social" },
    ];
    render(<SimpleConnectChips />);
    expect(screen.getByRole("link", { name: /Connect social/ })).toHaveAttribute(
      "href",
      "/under-the-hood/connections#connections-social"
    );
  });
});
