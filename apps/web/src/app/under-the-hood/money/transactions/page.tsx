import { PageHeader } from "@/components/PageHeader";
import { SpendLedgerTable } from "@/components/SpendBudgets";

export default function TransactionsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Money"
        title="Transactions"
        description="Every spend, whatever rail it moved over"
      />
      <div className="max-w-5xl px-8 pb-10">
        <SpendLedgerTable />
      </div>
    </>
  );
}
