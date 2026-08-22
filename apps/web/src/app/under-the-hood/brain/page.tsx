import { redirect } from "next/navigation";
import { UNDER_THE_HOOD_MODULES, moduleHref } from "@/lib/underTheHood";

export default function BrainPage() {
  const brain = UNDER_THE_HOOD_MODULES.find((m) => m.slug === "brain");
  redirect(brain ? moduleHref(brain) : "/");
}
