import { UnderTheHoodNav } from "@/components/UnderTheHoodNav";

/**
 * The machinery layer. Every module hangs off this route so they share one
 * sub-nav treatment and a new module is a folder rather than a refactor —
 * see UNDER_THE_HOOD_PLAN.md.
 */
export default function UnderTheHoodLayout({ children }: LayoutProps<"/under-the-hood">) {
  return (
    <>
      <UnderTheHoodNav />
      {children}
    </>
  );
}
