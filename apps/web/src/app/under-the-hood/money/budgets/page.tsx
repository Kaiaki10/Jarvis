import { PageHeader } from "@/components/PageHeader";
import { SpendBudgets } from "@/components/SpendBudgets";

export default function BudgetsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Money"
        title="Budgets"
        description="What Jarvis may spend, per rail. A rail with no limit does not spend at all"
      />
      <div className="max-w-5xl px-8 pb-10">
        <SpendBudgets />
      </div>
    </>
  );
}
