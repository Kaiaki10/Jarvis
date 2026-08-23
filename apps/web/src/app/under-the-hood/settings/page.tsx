import { PageHeader } from "@/components/PageHeader";
import { SettingsPanel, SETTINGS_SECTIONS } from "@/components/SettingsPanel";
import { SectionRail } from "@/components/motion";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Under the hood"
        title="Settings"
        description="Business context, safety rails, storage, recovery, and operating limits"
      />
      {/* The rail is supplementary — every section is still reachable by
          scrolling — so it is the first thing to go when the viewport can't
          spare the width. */}
      <div className="flex gap-10 px-8 pb-10">
        <div className="min-w-0 max-w-3xl flex-1">
          <SettingsPanel />
        </div>
        <SectionRail sections={SETTINGS_SECTIONS} className="hidden xl:block" />
      </div>
    </>
  );
}
