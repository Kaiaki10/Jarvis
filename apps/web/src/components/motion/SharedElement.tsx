"use client";

import * as React from "react";
import type { ReactNode } from "react";

/**
 * React's `<ViewTransition>`, reached defensively.
 *
 * It ships in the React build Next bundles for the App Router, but not in the
 * `@types/react` we compile against and not in the stable `react` in
 * node_modules — so it cannot be imported by name without a lie to the type
 * checker. Reading it off the namespace keeps the lie in one place, and makes
 * the absent case representable: if a future Next stops bundling it, this
 * renders children untouched instead of throwing.
 */
type ViewTransitionComponent = React.ComponentType<{
  name?: string;
  share?: string;
  default?: string;
  children?: ReactNode;
}>;

const ViewTransition = (React as unknown as { ViewTransition?: ViewTransitionComponent })
  .ViewTransition;

/**
 * Marks an element as the same thing on both sides of a navigation.
 *
 * Give the element the same `name` on the page you leave and the page you
 * arrive at, and the browser animates between its two positions rather than
 * cutting. What that buys is continuity: the run you clicked is visibly the run
 * you are now looking at, instead of one list vanishing and a page appearing.
 *
 * Three things have to hold for the morph to play, and it degrades to a plain
 * navigation whenever they don't:
 *
 * - The destination must render the element in the same commit as the
 *   navigation. If it waits on a fetch, there is nothing to pair with and the
 *   element simply appears. Read from the store rather than refetching.
 * - `name` must be unique among everything on screen. Ids, not labels.
 * - The child must be a single DOM element — this renders no wrapper of its
 *   own, it tags the child.
 *
 * `default="none"` keeps this element still during navigations it has nothing
 * to do with; without it, every named element animates on every transition
 * anywhere in the app. `share="morph"` is what CSS targets, and must stay:
 * `default="none"` with no `share` silently stops the morphing.
 */
export function SharedElement({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  if (!ViewTransition) return <>{children}</>;
  return (
    <ViewTransition name={name} share="morph" default="none">
      {children}
    </ViewTransition>
  );
}
