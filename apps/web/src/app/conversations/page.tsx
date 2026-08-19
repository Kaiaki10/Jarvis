import { ConversationRoom } from "@/components/ConversationRoom";
import { PageHeader } from "@/components/PageHeader";

export default function ConversationsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Agents talking"
        title="Conversations"
        description="Put two or more agents in a room with a topic, and watch them work it out"
      />
      <div className="px-8 pb-12">
        <ConversationRoom />
      </div>
    </>
  );
}
