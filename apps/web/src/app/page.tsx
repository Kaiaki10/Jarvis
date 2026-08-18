import { Header } from "@/components/hud/Header";
import { StatusPanel } from "@/components/hud/StatusPanel";
import { ActivityLog } from "@/components/hud/ActivityLog";
import { SessionLauncher } from "@/components/SessionLauncher";
import { SessionList } from "@/components/SessionList";
import { TaskBoard } from "@/components/TaskBoard";
import { ScheduledTasksPanel } from "@/components/ScheduledTasksPanel";

export default function Home() {
  return (
    <>
      <Header />
      <main className="flex-1 max-w-6xl mx-auto w-full p-6 flex flex-col gap-6">
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_320px] gap-6 items-start">
          <StatusPanel />
          <div className="py-4">
            <SessionLauncher />
          </div>
          <ActivityLog />
        </div>
        <SessionList />
        <ScheduledTasksPanel />
        <TaskBoard />
      </main>
    </>
  );
}
