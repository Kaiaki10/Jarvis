import { CustomerOperationsCenter } from "@/components/CustomerOperationsCenter";
import { PageHeader } from "@/components/PageHeader";

export default function CustomersPage() {
  return (
    <>
      <PageHeader
        eyebrow="Customer operations"
        title="Customers"
        description="One live queue for conversations, context, Jarvis-assisted replies, escalation, and follow-up"
      />
      <div className="px-8 pb-12">
        <CustomerOperationsCenter />
      </div>
    </>
  );
}
