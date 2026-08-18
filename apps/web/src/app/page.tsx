import { PageHeader } from "@/components/PageHeader";
import { JarvisChat } from "@/components/JarvisChat";
import { AttentionQueue } from "@/components/AttentionQueue";
import { StatsRow } from "@/components/StatsRow";
import { TodaySchedule } from "@/components/TodaySchedule";
import { AutomationHealth } from "@/components/AutomationHealth";
import { ActivityFeed } from "@/components/ActivityFeed";

export default function Home() {
  return (
    <>
      <PageHeader title="Jarvis" description="One ongoing conversation" />
      <div className="flex flex-col gap-6 px-8 pb-10">
        <AttentionQueue />
        <JarvisChat />
        <StatsRow />
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_360px]">
          <TodaySchedule />
          <ActivityFeed />
        </div>
        <AutomationHealth />
      </div>
    </>
  );
}
