import { PageHeader } from "@/components/PageHeader";
import { ScheduledTasksPanel } from "@/components/ScheduledTasksPanel";

export default function AutomationsPage() {
  return (
    <>
      <PageHeader
        title="Automations"
        description="Recurring tasks Jarvis fires on its own, on a schedule you set"
      />
      <div className="px-8 pb-10">
        <ScheduledTasksPanel />
      </div>
    </>
  );
}
