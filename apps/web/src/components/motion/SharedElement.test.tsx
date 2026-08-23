import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SharedElement } from "./SharedElement";

describe("SharedElement", () => {
  it("renders its child either way", () => {
    render(
      <SharedElement name="run-title-abc">
        <span>A run</span>
      </SharedElement>
    );
    expect(screen.getByText("A run")).toBeInTheDocument();
  });

  it("does not wrap the child in an element of its own", () => {
    const { container } = render(
      <SharedElement name="run-title-abc">
        <span data-testid="child">A run</span>
      </SharedElement>
    );
    // The morph tags the child; an extra wrapper would change the box being
    // animated and quietly break the layouts this is dropped into.
    expect(container.firstElementChild).toBe(screen.getByTestId("child"));
  });

  it("degrades to plain content where React has no ViewTransition", () => {
    // Vitest resolves the stable `react` in node_modules, which does not export
    // ViewTransition — Next substitutes a canary build for the app. So this
    // test runs the exact fallback a browser without support would take, and
    // asserts the content is still there rather than swallowed.
    expect(
      (React as unknown as { ViewTransition?: unknown }).ViewTransition
    ).toBeUndefined();

    render(
      <SharedElement name="run-title-abc">
        <span>Still readable</span>
      </SharedElement>
    );
    expect(screen.getByText("Still readable")).toBeInTheDocument();
  });
});
