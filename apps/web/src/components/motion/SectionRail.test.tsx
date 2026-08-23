import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SectionRail } from "./SectionRail";

const SECTIONS = [
  { id: "one", label: "One" },
  { id: "two", label: "Two" },
  { id: "three", label: "Three" },
];

/** Fires its callback on demand, standing in for a real scroll. */
let notify: () => void = () => {};
let host: HTMLElement | null = null;

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
});

afterEach(() => {
  // These are appended by hand, so testing-library's cleanup does not take
  // them. Left behind, the next test's getElementById finds this test's
  // sections instead of its own.
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

/** Places the sections in the document at the given distances from the top. */
function renderWithSections(tops: Record<string, number>) {
  host = document.createElement("div");
  for (const section of SECTIONS) {
    const el = document.createElement("section");
    el.id = section.id;
    el.getBoundingClientRect = () => ({ top: tops[section.id] ?? 0 }) as DOMRect;
    el.scrollIntoView = vi.fn();
    host.appendChild(el);
  }
  document.body.appendChild(host);
  return render(<SectionRail sections={SECTIONS} />);
}

function current(): string | null {
  return screen.getByRole("navigation").querySelector("[aria-current]")?.textContent ?? null;
}

describe("SectionRail", () => {
  it("marks the last section whose top has passed the line", () => {
    // One and Two are above the line, Three is still below it.
    renderWithSections({ one: -400, two: 40, three: 900 });
    expect(current()).toBe("Two");
  });

  it("keeps the first section active before anything has scrolled", () => {
    renderWithSections({ one: 300, two: 900, three: 1500 });
    expect(current()).toBe("One");
  });

  it("follows the reader down the page", () => {
    const tops: Record<string, number> = { one: -400, two: 40, three: 900 };
    renderWithSections(tops);
    expect(current()).toBe("Two");

    tops.two = -500;
    tops.three = 10;
    act(() => notify());
    expect(current()).toBe("Three");
  });

  it("scrolls to a section rather than following the anchor", () => {
    renderWithSections({ one: 0, two: 900, three: 1500 });
    const target = document.getElementById("three")!;
    fireEvent.click(screen.getByRole("link", { name: "Three" }));
    expect(target.scrollIntoView).toHaveBeenCalled();
    // The hash is worth having — a section becomes a link you can send someone.
    expect(window.location.hash).toBe("#three");
  });

  it("stays out of the way when there is nothing to navigate", () => {
    const { container } = render(<SectionRail sections={[{ id: "only", label: "Only" }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
