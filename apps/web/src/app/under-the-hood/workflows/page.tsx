import { WorkflowStudio } from "@/components/WorkflowStudio";
import { PageHeader } from "@/components/PageHeader";

export default function WorkflowsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Under the hood"
        title="Workflows"
        description="One operation per business — its accounts, content, and what it learned"
      />
      <div className="px-8 pb-12">
        <WorkflowStudio />
      </div>
    </>
  );
}
