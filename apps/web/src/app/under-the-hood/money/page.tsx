import { redirect } from "next/navigation";
import { UNDER_THE_HOOD_MODULES, moduleHref } from "@/lib/underTheHood";

export default function MoneyPage() {
  const money = UNDER_THE_HOOD_MODULES.find((m) => m.slug === "money");
  redirect(money ? moduleHref(money) : "/");
}
