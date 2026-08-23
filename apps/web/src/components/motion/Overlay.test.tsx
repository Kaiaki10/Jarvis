import { fireEvent, render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Overlay } from "./Overlay";

describe("Overlay", () => {
  it("dismisses on escape", () => {
    const onDismiss = vi.fn();
    render(
      <Overlay open onDismiss={onDismiss}>
        <p>Panel</p>
      </Overlay>
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("dismisses on a click outside the panel", () => {
    const onDismiss = vi.fn();
    render(
      <Overlay open onDismiss={onDismiss}>
        <p>Panel</p>
      </Overlay>
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("does not dismiss on a click inside the panel", () => {
    const onDismiss = vi.fn();
    render(
      <Overlay open onDismiss={onDismiss}>
        <button type="button">Save</button>
      </Overlay>
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("stops listening for escape once closed", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <Overlay open onDismiss={onDismiss}>
        <p>Panel</p>
      </Overlay>
    );
    rerender(
      <Overlay open={false} onDismiss={onDismiss}>
        <p>Panel</p>
      </Overlay>
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("keeps the panel mounted long enough to animate out", async () => {
    const { rerender } = render(
      <Overlay open onDismiss={() => {}}>
        <p>Panel</p>
      </Overlay>
    );
    expect(screen.getByText("Panel")).toBeInTheDocument();
    rerender(
      <Overlay open={false} onDismiss={() => {}}>
        <p>Panel</p>
      </Overlay>
    );
    // The point of the primitive: it leaves, but not instantly.
    await waitForElementToBeRemoved(() => screen.queryByText("Panel"));
  });
});
