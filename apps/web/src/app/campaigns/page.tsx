import { CampaignStudio } from "@/components/CampaignStudio";
import { PageHeader } from "@/components/PageHeader";

export default function CampaignsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Growth engine"
        title="Campaigns"
        description="Turn an objective into coordinated content, approvals, publishing, and learning"
      />
      <div className="px-8 pb-12">
        <CampaignStudio />
      </div>
    </>
  );
}
