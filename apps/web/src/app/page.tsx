import { PageHeader } from "@/components/PageHeader";
import { SessionLauncher } from "@/components/SessionLauncher";
import { StatsRow } from "@/components/StatsRow";
import { SessionList } from "@/components/SessionList";
import { ActivityFeed } from "@/components/ActivityFeed";

export default function Home() {
  return (
    <>
      <PageHeader title="Overview" description="What should Jarvis work on?" />
      <div className="px-8 pb-10 flex flex-col gap-6">
        <SessionLauncher />
        <StatsRow />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px] items-start">
          <SessionList limit={6} showViewAll />
          <ActivityFeed />
        </div>
      </div>
    </>
  );
}
