import { MarketingCenter } from "@/components/MarketingCenter";
import { PageHeader } from "@/components/PageHeader";

export default function MarketingPage() {
  return (
    <>
      <PageHeader
        eyebrow="Brand marketing"
        title="Marketing"
        description="Each brand holds its voice and logo. Scripts are written by Jarvis, approved by you, and only then generated on Artlist."
      />
      <div className="px-8 pb-12">
        <MarketingCenter />
      </div>
    </>
  );
}
