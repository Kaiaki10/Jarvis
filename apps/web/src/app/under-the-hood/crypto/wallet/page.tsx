import { PageHeader } from "@/components/PageHeader";
import { CryptoWallet } from "@/components/CryptoWallet";

export default function CryptoWalletPage() {
  return (
    <>
      <PageHeader
        eyebrow="Crypto"
        title="Wallet"
        description="What Jarvis is permitted to spend on-chain, and the limit it holds itself to"
      />
      <div className="max-w-5xl px-8 pb-10">
        <CryptoWallet />
      </div>
    </>
  );
}
