import { redirect } from "next/navigation";
import { UNDER_THE_HOOD_MODULES, moduleHref } from "@/lib/underTheHood";

export default function SocialPage() {
  const social = UNDER_THE_HOOD_MODULES.find((m) => m.slug === "social");
  redirect(social ? moduleHref(social) : "/");
}
