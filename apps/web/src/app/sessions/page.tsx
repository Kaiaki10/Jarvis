import { PageHeader } from "@/components/PageHeader";
import { SessionList } from "@/components/SessionList";

export default function SessionsPage() {
  return (
    <>
      <PageHeader title="Sessions" description="Every Claude Code session Jarvis has run" />
      <div className="px-8 pb-10">
        <SessionList />
      </div>
    </>
  );
}
