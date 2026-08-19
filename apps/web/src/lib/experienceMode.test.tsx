import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ExperienceModeProvider, useExperienceMode } from "./experienceMode";

function ModeProbe() {
  const { mode, setMode } = useExperienceMode();
  return <button onClick={() => setMode("under-the-hood")}>{mode}</button>;
}

describe("ExperienceModeProvider", () => {
  afterEach(() => window.localStorage.clear());

  it("starts simple and persists the under-the-hood choice", () => {
    render(<ExperienceModeProvider><ModeProbe /></ExperienceModeProvider>);
    const toggle = screen.getByRole("button", { name: "simple" });
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent("under-the-hood");
    expect(window.localStorage.getItem("jarvis-experience-mode")).toBe("under-the-hood");
  });
});
