import { ConnectionWizard } from "@/components/ConnectionWizard";

export default async function ConnectionSetupPage({
  params,
}: {
  params: Promise<{ platformId: string }>;
}) {
  const { platformId } = await params;
  return (
    <div className="pt-8">
      <ConnectionWizard platformId={platformId} />
    </div>
  );
}
