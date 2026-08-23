import { redirect } from "next/navigation";
import { UNDER_THE_HOOD_MODULES, moduleHref } from "@/lib/underTheHood";

export default function CryptoPage() {
  const crypto = UNDER_THE_HOOD_MODULES.find((m) => m.slug === "crypto");
  redirect(crypto ? moduleHref(crypto) : "/");
}
