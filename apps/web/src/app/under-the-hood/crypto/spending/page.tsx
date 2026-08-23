import { PageHeader } from "@/components/PageHeader";
import { CryptoSpending } from "@/components/CryptoWallet";

export default function CryptoSpendingPage() {
  return (
    <>
      <PageHeader
        eyebrow="Crypto"
        title="Spending"
        description="Every on-chain spend, with its transaction"
      />
      <div className="max-w-5xl px-8 pb-10">
        <CryptoSpending />
      </div>
    </>
  );
}
