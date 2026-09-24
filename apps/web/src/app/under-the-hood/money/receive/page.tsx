import { PageHeader } from "@/components/PageHeader";
import { ReceiveMoneyPanel } from "@/components/ReceiveMoneyPanel";

export default function ReceivePage() {
  return (
    <>
      <PageHeader
        eyebrow="Money"
        title="Receive"
        description="Payment links to get paid, and the receipts Stripe confirms"
      />
      <div className="max-w-5xl px-8 pb-10">
        <ReceiveMoneyPanel />
      </div>
    </>
  );
}
