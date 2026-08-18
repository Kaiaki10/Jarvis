import { PageHeader } from "@/components/PageHeader";
import { SettingsPanel } from "@/components/SettingsPanel";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Context Jarvis carries into every session, plus safety rails"
      />
      <div className="px-8 pb-10 max-w-3xl">
        <SettingsPanel />
      </div>
    </>
  );
}
