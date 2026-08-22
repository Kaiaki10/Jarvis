import { PageHeader } from "@/components/PageHeader";
import { ScheduledTasksPanel } from "@/components/ScheduledTasksPanel";

export default function AutomationsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Unattended work"
        title="Automations"
        description="Scheduled Jarvis runs with rehearsal, safeguards, and execution history"
      />
      <div className="px-8 pb-10">
        <ScheduledTasksPanel />
      </div>
    </>
  );
}
