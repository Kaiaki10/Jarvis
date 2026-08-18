import { PageHeader } from "@/components/PageHeader";
import { JarvisChat } from "@/components/JarvisChat";
import { AttentionQueue } from "@/components/AttentionQueue";
import { StatsRow } from "@/components/StatsRow";
import { TodaySchedule } from "@/components/TodaySchedule";
import { AutomationHealth } from "@/components/AutomationHealth";
import { ActivityFeed } from "@/components/ActivityFeed";
import { Stagger } from "@/components/Stagger";

export default function Home() {
  return (
    <>
      <PageHeader eyebrow="Command center" title="Jarvis" description="One ongoing conversation" />
      <div className="flex flex-col gap-6 px-8 pb-12">
        <Stagger index={0}>
          <AttentionQueue />
        </Stagger>
        <Stagger index={1}>
          <JarvisChat />
        </Stagger>
        <Stagger index={2}>
          <StatsRow />
        </Stagger>
        <Stagger index={3}>
          <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[1fr_360px]">
            <TodaySchedule />
            <ActivityFeed />
          </div>
        </Stagger>
        <Stagger index={4}>
          <AutomationHealth />
        </Stagger>
      </div>
    </>
  );
}
