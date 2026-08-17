import { SessionDetail } from "@/components/SessionDetail";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="p-6">
      <SessionDetail sessionId={id} />
    </main>
  );
}
