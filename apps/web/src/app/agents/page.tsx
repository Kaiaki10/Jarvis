import { AgentPicker } from "@/components/AgentPicker";
import { PageHeader } from "@/components/PageHeader";

export default function AgentsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Who is working"
        title="Agents"
        description="Each agent has its own persona, working directory, and ongoing conversation"
      />
      <div className="px-8 pb-12">
        <AgentPicker />
      </div>
    </>
  );
}
