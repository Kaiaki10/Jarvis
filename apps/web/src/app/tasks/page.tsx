import { PageHeader } from "@/components/PageHeader";
import { TaskBoard } from "@/components/TaskBoard";

export default function TasksPage() {
  return (
    <>
      <PageHeader
        eyebrow="Human work"
        title="Tasks"
        description="A deliberate queue for work that should not run automatically"
      />
      <div className="px-8 pb-10">
        <TaskBoard />
      </div>
    </>
  );
}
