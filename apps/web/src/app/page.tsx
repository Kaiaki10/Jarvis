import { SessionLauncher } from "@/components/SessionLauncher";
import { SessionList } from "@/components/SessionList";
import { TaskBoard } from "@/components/TaskBoard";

export default function Home() {
  return (
    <main className="flex flex-col gap-4 max-w-3xl mx-auto w-full p-6">
      <h1 className="text-xl font-semibold">Jarvis</h1>
      <SessionLauncher />
      <SessionList />
      <TaskBoard />
    </main>
  );
}
