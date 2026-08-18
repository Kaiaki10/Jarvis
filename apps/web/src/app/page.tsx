import { PageHeader } from "@/components/PageHeader";
import { JarvisChat } from "@/components/JarvisChat";
import { AttentionQueue } from "@/components/AttentionQueue";
import { StatsRow } from "@/components/StatsRow";
import { TodaySchedule } from "@/components/TodaySchedule";
import { AutomationHealth } from "@/components/AutomationHealth";
import { ActivityFeed } from "@/components/ActivityFeed";
import { Reveal, Stagger } from "@/components/motion";

export default function Home() {
  return (
    <>
      <PageHeader eyebrow="Command center" title="Jarvis" description="One ongoing conversation" />
      <div className="flex flex-col gap-6 px-8 pb-12">
        {/* Above the fold: staggered on load. Anything you need immediately is
            never gated behind a scroll. */}
        <Stagger index={0}>
          <AttentionQueue />
        </Stagger>
        <Stagger index={1}>
          <JarvisChat />
        </Stagger>
        <Stagger index={2}>
          <StatsRow />
        </Stagger>

        {/* Below the fold: revealed on approach, once. */}
        <Reveal>
          <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[1fr_360px]">
            <TodaySchedule />
            <ActivityFeed />
          </div>
        </Reveal>
        <Reveal delay={60}>
          <AutomationHealth />
        </Reveal>
      </div>
    </>
  );
}
