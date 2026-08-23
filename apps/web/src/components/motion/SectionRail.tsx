"use client";

import { useEffect, useState } from "react";

export interface RailSection {
  /** Must match the `id` on the section element in the document. */
  id: string;
  label: string;
}

/** Where a section counts as "the one you're reading", in px from the top. */
const ACTIVE_LINE = 128;

/**
 * Where you are in a long page, and a way to jump.
 *
 * Settings and Connections are long enough that scrolling loses you: the
 * headings pass by, and nothing on screen says how much is left or what you
 * have already gone past. This is the map.
 *
 * Scroll-*linked*, never scroll-hijacked — it reports position and responds to
 * clicks, and never takes the scroll away from you. Nothing here is
 * load-bearing: without it every section is still reachable by scrolling, which
 * is why it can hide entirely on narrow screens.
 *
 * Driven by IntersectionObserver rather than a scroll handler. A scroll handler
 * would run on every frame of every scroll on the page's longest documents;
 * this only wakes when a section boundary actually crosses the line.
 */
export function SectionRail({
  sections,
  className = "",
}: {
  sections: readonly RailSection[];
  className?: string;
}) {
  const [active, setActive] = useState<string>(sections[0]?.id ?? "");
  // Bumped when the sections finally exist, to re-run the effect below.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const find = () =>
      sections
        .map((section) => document.getElementById(section.id))
        .filter((el): el is HTMLElement => el !== null);

    const elements = find();

    if (elements.length === 0) {
      /**
       * Absent at mount is not absent for good.
       *
       * Both pages using this render their sections only once data has
       * arrived — Settings shows a loading line, and Connections drops every
       * empty category, so on the first render there are literally none.
       * Giving up here left the rail stuck on its first entry no matter how
       * far you scrolled, on every page it was used.
       *
       * The watcher lives only while there is nothing to observe.
       */
      const waiting = new MutationObserver(() => {
        if (find().length === 0) return;
        waiting.disconnect();
        setAttempt((n) => n + 1);
      });
      waiting.observe(document.body, { childList: true, subtree: true });
      return () => waiting.disconnect();
    }

    /**
     * The active section is the last one whose top has passed the line.
     *
     * Measured rather than taken from the observer entries: an entry only tells
     * you that *something* crossed, and with several sections on screen at once
     * the entries arrive in no useful order. Reading the rects is exact, and it
     * happens on crossings only, not per frame.
     */
    function pick() {
      let current = sections[0]?.id ?? "";
      for (const section of sections) {
        const el = document.getElementById(section.id);
        if (el && el.getBoundingClientRect().top <= ACTIVE_LINE) current = section.id;
      }
      setActive((previous) => (previous === current ? previous : current));
    }

    const observer = new IntersectionObserver(pick, {
      // Shrinks the root to a band starting at the line, so a section entering
      // or leaving it is what wakes this up.
      rootMargin: `-${ACTIVE_LINE}px 0px 0px 0px`,
      threshold: [0, 0.25, 0.5, 0.75, 1],
    });
    for (const el of elements) observer.observe(el);

    // The observer does not fire on mount for a page restored mid-scroll.
    pick();

    return () => observer.disconnect();
  }, [sections, attempt]);

  if (sections.length < 2) return null;

  return (
    <nav aria-label="On this page" className={`w-44 shrink-0 ${className}`}>
      <div className="sticky top-24">
        <div className="mb-2.5 pl-3 text-micro font-semibold tracking-[0.14em] text-muted uppercase">
          On this page
        </div>
        <ul className="flex flex-col">
          {sections.map((section) => {
            const current = section.id === active;
            return (
              <li key={section.id}>
                {/* A real anchor: it works before hydration, opens in a new tab
                    like any link, and gives the section a URL worth sending
                    someone. The handler only smooths the motion. */}
                <a
                  href={`#${section.id}`}
                  aria-current={current ? "true" : undefined}
                  onClick={(event) => {
                    const el = document.getElementById(section.id);
                    if (!el) return;
                    event.preventDefault();
                    el.scrollIntoView({
                      // Smooth scrolling is movement the reader did not ask
                      // for, so it is the first thing to go under reduced
                      // motion — the jump still lands in the same place.
                      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                        ? "auto"
                        : "smooth",
                      block: "start",
                    });
                    // replaceState, not a hash assignment: making every jump a
                    // history entry would turn Back into a walk up the page.
                    history.replaceState(null, "", `#${section.id}`);
                  }}
                  className={`block border-l py-1.5 pl-3 text-label transition-colors ${
                    current
                      ? "border-accent text-foreground"
                      : "border-border text-muted hover:border-border-strong hover:text-foreground-secondary"
                  }`}
                >
                  {section.label}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
