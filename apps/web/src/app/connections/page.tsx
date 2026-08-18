import { PageHeader } from "@/components/PageHeader";
import { ConnectionsList } from "@/components/ConnectionsList";

export default function ConnectionsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Channels & delivery"
        title="Connections"
        description="Connect the platforms Jarvis can publish to, message through, measure, and grow from"
      />
      <div className="max-w-6xl px-8 pb-10">
        <ConnectionsList />
      </div>
    </>
  );
}
