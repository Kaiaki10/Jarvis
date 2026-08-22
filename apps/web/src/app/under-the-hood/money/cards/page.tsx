import { PageHeader } from "@/components/PageHeader";
import { StripeCardsPanel } from "@/components/StripeCardsPanel";

export default function CardsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Money"
        title="Cards"
        description="Virtual cards Jarvis has issued, and the authority each one carries"
      />
      <div className="max-w-5xl px-8 pb-10">
        <StripeCardsPanel />
      </div>
    </>
  );
}
