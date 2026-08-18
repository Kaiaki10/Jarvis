import { PageHeader } from "@/components/PageHeader";
import { PaidGrowthCenter } from "@/components/PaidGrowthCenter";

export default function PaidGrowthPage() {
  return (
    <>
      <PageHeader
        eyebrow="Paid acquisition"
        title="Paid Growth"
        description="Allocate budget, pace spend, measure returns, and review every material investment decision"
      />
      <div className="px-8 pb-12">
        <PaidGrowthCenter />
      </div>
    </>
  );
}
