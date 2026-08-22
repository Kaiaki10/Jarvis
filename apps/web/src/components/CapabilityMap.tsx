"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  Brain,
  CalendarClock,
  Flag,
  FlaskConical,
  Headphones,
  Megaphone,
  Orbit,
} from "lucide-react";
import {
  useWorkflows,
  useCustomerOperations,
  useEvolution,
  useMemories,
  useMissionsList,
  useScheduledTasksList,
  usePaidGrowth,
} from "@/lib/store";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";

export function CapabilityMap() {
  const { missions } = useMissionsList();
  const { overview: campaigns } = useWorkflows();
  const { overview: customerOperations } = useCustomerOperations();
  const { memories } = useMemories();
  const { tasks: automations } = useScheduledTasksList();
  const { evolution } = useEvolution();
  const { overview: paidGrowth } = usePaidGrowth();

  const capabilities = [
    {
      href: "/missions",
      title: "Mission control",
      description: "Turn outcomes into plans, tasks, runs, and deliverables.",
      status: `${missions.filter((mission) => mission.status === "active").length} active`,
      tone: "accent" as const,
      icon: Flag,
    },
    {
      href: "/under-the-hood/workflows",
      title: "Growth engine",
      description: "Create content, manage paid investment, publish, measure, and learn.",
      status: `${campaigns?.workflows.filter((campaign) => campaign.status === "active").length ?? 0} owned · ${paidGrowth?.totals.active ?? 0} paid`,
      tone: "accent" as const,
      icon: Megaphone,
    },
    {
      href: "/customers",
      title: "Customer operations",
      description: "Handle website, email, and social conversations with guardrails.",
      status: `${customerOperations?.conversations.filter((conversation) => conversation.status === "open").length ?? 0} open`,
      tone: "accent" as const,
      icon: Headphones,
    },
    {
      href: "/memory",
      title: "Durable memory",
      description: "Keep business context current through automatic turn reflection.",
      status: `${memories.filter((memory) => memory.status === "active").length} memories`,
      tone: "success" as const,
      icon: Brain,
    },
    {
      href: "/automations",
      title: "Unattended work",
      description: "Run recurring work on schedule, with rehearsal and safeguards.",
      status: `${automations.filter((automation) => automation.enabled).length}/${automations.length} enabled`,
      tone: "success" as const,
      icon: CalendarClock,
    },
    {
      href: "/evolution",
      title: "Safe evolution",
      description: "Build improvements in the Lab, verify them, then promote safely.",
      status: evolution?.readiness.labAvailable ? "Lab ready" : "Lab unavailable",
      tone: evolution?.readiness.labAvailable ? ("success" as const) : ("warning" as const),
      icon: FlaskConical,
    },
  ];

  return (
    <section aria-label="Jarvis operating system">
      <Card>
        <CardHeader
          title="Jarvis operating system"
          description="One operating loop across six capabilities, working from shared context."
        />
        <div className="grid grid-cols-1 gap-3 px-5 pb-5 md:grid-cols-2 xl:grid-cols-3">
          <Link href="/operate" className="group block md:col-span-2 xl:col-span-3">
            <Card
              elevation={2}
              interactive
              className="relative overflow-hidden p-4 group-focus-visible:border-accent"
            >
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-accent/15 via-transparent to-transparent" />
              <div className="relative flex items-center gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-bright ring-1 ring-inset ring-accent/25">
                  <Orbit className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-heading text-foreground">Operate Jarvis</h3>
                    <Badge tone="accent" dot pulse>Connected loop</Badge>
                  </div>
                  <p className="mt-1 text-label text-muted">
                    Give Jarvis one outcome, then coordinate strategy, content, customers, learning, and improvement.
                  </p>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-accent-bright" strokeWidth={1.75} />
              </div>
            </Card>
          </Link>
          {capabilities.map(({ href, title, description, status, tone, icon: Icon }) => (
            <Link key={href} href={href} className="group block">
              <Card
                elevation={0}
                interactive
                className="h-full p-4 group-focus-visible:border-accent"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-white/[0.04] text-accent-bright">
                    <Icon className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  <ArrowUpRight
                    className="h-4 w-4 text-muted transition-colors group-hover:text-foreground"
                    strokeWidth={1.75}
                  />
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <h3 className="text-body font-semibold text-foreground">{title}</h3>
                  <Badge tone={tone}>{status}</Badge>
                </div>
                <p className="mt-1.5 text-label leading-relaxed text-muted">{description}</p>
              </Card>
            </Link>
          ))}
        </div>
      </Card>
    </section>
  );
}
