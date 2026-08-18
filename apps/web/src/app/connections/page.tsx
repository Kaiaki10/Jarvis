import { PageHeader } from "@/components/PageHeader";
import { ConnectionsList } from "@/components/ConnectionsList";

export default function ConnectionsPage() {
  return (
    <>
      <PageHeader
        title="Connections"
        description="Link the platforms Jarvis works on your behalf. Each one walks you through what it needs."
      />
      <div className="px-8 pb-10 max-w-4xl">
        <ConnectionsList />
      </div>
    </>
  );
}
