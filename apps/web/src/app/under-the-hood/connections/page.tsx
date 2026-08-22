import { PageHeader } from "@/components/PageHeader";
import { ConnectionsList } from "@/components/ConnectionsList";

export default function ConnectionsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Under the hood"
        title="Connections"
        description="Every platform Jarvis can reach, grouped by what it does"
      />
      <div className="max-w-6xl px-8 pb-10">
        <ConnectionsList />
      </div>
    </>
  );
}
