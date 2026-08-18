import { PageHeader } from "@/components/PageHeader";
import { SessionList } from "@/components/SessionList";

export default function SessionsPage() {
  return (
    <>
      <PageHeader
        title="Runs"
        description="Every automation run, kept so you can read back what happened"
      />
      <div className="px-8 pb-10">
        <SessionList />
      </div>
    </>
  );
}
