import { PageHeader } from "@/components/PageHeader";
import { SessionList } from "@/components/SessionList";

export default function SessionsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Execution history"
        title="Runs"
        description="Every Jarvis run, with its transcript, actions, and outcome"
      />
      <div className="px-8 pb-10">
        <SessionList />
      </div>
    </>
  );
}
