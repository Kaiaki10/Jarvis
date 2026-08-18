import { PageHeader } from "@/components/PageHeader";
import { SessionLauncher } from "@/components/SessionLauncher";
import { AttentionQueue } from "@/components/AttentionQueue";
import { StatsRow } from "@/components/StatsRow";
import { TodaySchedule } from "@/components/TodaySchedule";
import { AutomationHealth } from "@/components/AutomationHealth";
import { SessionList } from "@/components/SessionList";
import { ActivityFeed } from "@/components/ActivityFeed";

export default function Home() {
  return (
    <>
      <PageHeader title="Overview" description="What should Jarvis work on?" />
      <div className="px-8 pb-10 flex flex-col gap-6">
        <SessionLauncher />
        <AttentionQueue />
        <StatsRow />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px] items-start">
          <TodaySchedule />
          <ActivityFeed />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 items-start">
          <SessionList limit={5} showViewAll />
          <AutomationHealth />
        </div>
      </div>
    </>
  );
}
