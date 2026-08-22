import { PageHeader } from "@/components/PageHeader";
import { SettingsPanel } from "@/components/SettingsPanel";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Under the hood"
        title="Settings"
        description="Business context, safety rails, storage, recovery, and operating limits"
      />
      <div className="px-8 pb-10 max-w-3xl">
        <SettingsPanel />
      </div>
    </>
  );
}
