import { EvolutionCenter } from "@/components/EvolutionCenter";
import { PageHeader } from "@/components/PageHeader";

export default function EvolutionPage() {
  return (
    <>
      <PageHeader eyebrow="Self-improvement" title="Evolution" description="Jarvis observes, experiments, verifies, and earns its way into production" />
      <div className="px-8 pb-12">
        <EvolutionCenter />
      </div>
    </>
  );
}
