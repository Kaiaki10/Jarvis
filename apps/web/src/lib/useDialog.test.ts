import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDialog } from "./useDialog";

describe("useDialog", () => {
  it("starts closed", () => {
    const { result } = renderHook(() => useDialog());
    expect(result.current.open).toBe(false);
  });

  it("holds the key steady while closing, so the exit animation is not cut short", () => {
    const { result } = renderHook(() => useDialog());
    act(() => result.current.show());
    const whileOpen = result.current.key;

    act(() => result.current.hide());
    expect(result.current.open).toBe(false);
    // A key change here would remount the dialog mid-exit, which reads as it
    // vanishing — the exact thing keeping it mounted was meant to prevent.
    expect(result.current.key).toBe(whileOpen);
  });

  it("hands out a new key on each open, so a cancelled form starts empty", () => {
    const { result } = renderHook(() => useDialog());
    act(() => result.current.show());
    const first = result.current.key;

    act(() => result.current.hide());
    act(() => result.current.show());
    expect(result.current.key).not.toBe(first);
  });

  it("keeps show and hide stable, so they can be passed as props without rerendering children", () => {
    const { result } = renderHook(() => useDialog());
    const { show, hide } = result.current;
    act(() => result.current.show());
    expect(result.current.show).toBe(show);
    expect(result.current.hide).toBe(hide);
  });
});
