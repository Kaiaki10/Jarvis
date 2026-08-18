import { MissionWorkspace } from "@/components/MissionWorkspace";
import { PageHeader } from "@/components/PageHeader";

export default function MissionsPage() {
  return (
    <>
      <PageHeader eyebrow="Outcomes" title="Missions" description="Work that stays organized around a result" />
      <div className="px-8 pb-12">
        <MissionWorkspace />
      </div>
    </>
  );
}
