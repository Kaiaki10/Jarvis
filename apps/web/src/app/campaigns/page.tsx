import { WorkflowStudio } from "@/components/WorkflowStudio";
import { PageHeader } from "@/components/PageHeader";

export default function CampaignsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Marketing"
        title="Campaigns"
        description="Objective in, content out — accounts, drafts, approvals, publishing, and what it learned"
      />
      <div className="px-8 pb-12">
        <WorkflowStudio />
      </div>
    </>
  );
}
