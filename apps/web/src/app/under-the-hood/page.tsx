import { redirect } from "next/navigation";
import { moduleHref, visibleModules } from "@/lib/underTheHood";

/**
 * The layer has no landing screen of its own yet — an Overview belongs here
 * eventually, but a placeholder would be worse than going straight to the
 * first module that has something to show.
 */
export default function UnderTheHoodPage() {
  const first = visibleModules()[0];
  redirect(first ? moduleHref(first) : "/");
}
