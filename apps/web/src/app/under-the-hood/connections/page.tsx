import { PageHeader } from "@/components/PageHeader";
import { ConnectionsList, CONNECTION_SECTIONS } from "@/components/ConnectionsList";
import { SectionRail } from "@/components/motion";

export default function ConnectionsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Under the hood"
        title="Connections"
        description="Every platform Jarvis can reach, grouped by what it does"
      />
      {/* The rail is supplementary — every section is still reachable by
          scrolling — so it is the first thing to go when the viewport can't
          spare the width. */}
      <div className="flex gap-10 px-8 pb-10">
        <div className="min-w-0 max-w-6xl flex-1">
          <ConnectionsList />
        </div>
        <SectionRail sections={CONNECTION_SECTIONS} className="hidden xl:block" />
      </div>
    </>
  );
}
