import { PageHeader } from "@/components/PageHeader";
import { TaskBoard } from "@/components/TaskBoard";

export default function TasksPage() {
  return (
    <>
      <PageHeader title="Tasks" description="A simple list — nothing here runs itself" />
      <div className="px-8 pb-10">
        <TaskBoard />
      </div>
    </>
  );
}
