import { AutonomousBusinessLoop } from "@/components/AutonomousBusinessLoop";
import { PageHeader } from "@/components/PageHeader";

export default function OperatePage() {
  return (
    <>
      <PageHeader
        eyebrow="Autonomous business loop"
        title="Operate"
        description="One outcome in. Jarvis plans, creates, serves, learns, and improves around it."
      />
      <div className="px-8 pb-12">
        <AutonomousBusinessLoop />
      </div>
    </>
  );
}
