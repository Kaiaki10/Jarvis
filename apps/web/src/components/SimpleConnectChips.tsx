"use client";

import Link from "next/link";
import { Wallet, AtSign } from "lucide-react";
import { useConnections } from "@/lib/store";
import { Pressable } from "@/components/motion";

/**
 * The two connections worth offering from the front door.
 *
 * Simple mode deliberately has no navigation, which also means no way to
 * discover that Jarvis can hold a wallet or post as you. These are the two
 * capabilities people actually come looking for, so they get a quiet door here
 * rather than requiring a trip through Under the Hood to find out they exist.
 *
 * Sized to sit in the same meta row as the memory count — this is a hint, not a
 * call to action. Simple mode's whole point is the conversation; a pair of
 * primary buttons on the hero would be arguing with that.
 *
 * Once connected these stop asking and start reporting, because a button that
 * still says "Connect" after you have is just noise.
 */
export function SimpleConnectChips() {
  const { platforms, connections } = useConnections();

  const wallet = connections.find((connection) => connection.platformId === "coinbase");
  const walletReady = wallet?.status === "connected";

  const socialIds = platforms
    .filter((platform) => platform.category === "social")
    .map((platform) => platform.id);
  const socialAccounts = connections.filter(
    (connection) => socialIds.includes(connection.platformId) && connection.status === "connected"
  );

  // One social platform today, so send them straight to it. More than one and
  // the category heading on Connections is the honest destination — it exists
  // as an anchor precisely because the page grew a section rail.
  const socialHref =
    socialIds.length === 1
      ? `/under-the-hood/connections/${socialIds[0]}`
      : "/under-the-hood/connections#connections-social";

  return (
    <>
      <Chip
        href="/under-the-hood/connections/coinbase"
        icon={<Wallet className="h-3.5 w-3.5" strokeWidth={1.75} />}
        connected={walletReady}
        label={walletReady ? "Wallet ready" : "Connect wallet"}
      />
      <Chip
        href={socialHref}
        icon={<AtSign className="h-3.5 w-3.5" strokeWidth={1.75} />}
        connected={socialAccounts.length > 0}
        label={
          socialAccounts.length === 0
            ? "Connect social"
            : socialAccounts.length === 1
              ? "Social connected"
              : `${socialAccounts.length} accounts`
        }
      />
    </>
  );
}

function Chip({
  href,
  icon,
  label,
  connected,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  connected: boolean;
}) {
  return (
    <Pressable lift={1}>
      <Link
        href={href}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-micro transition-colors ${
          connected
            ? "border-success/25 bg-success/[0.06] text-success"
            : "border-border bg-white/[0.02] text-muted hover:border-border-strong hover:text-foreground"
        }`}
      >
        {icon}
        {label}
      </Link>
    </Pressable>
  );
}
