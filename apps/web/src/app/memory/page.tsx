import { MemoryCenter } from "@/components/MemoryCenter";
import { PageHeader } from "@/components/PageHeader";

export default function MemoryPage() {
  return (
    <>
      <PageHeader
        eyebrow="Relationship context"
        title="Memory"
        description="See and control the durable facts Jarvis carries into future conversations"
      />
      <div className="px-8 pb-12">
        <MemoryCenter />
      </div>
    </>
  );
}
