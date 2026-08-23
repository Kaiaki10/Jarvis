"use client";

import { useEffect, useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import type { StripeCardRecord } from "@jarvis/shared";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatMoney } from "@/lib/money";
import { AnimatedItem, AnimatedList, Crossfade } from "@/components/motion";

/** Only a card that can still be charged consumes the card envelope. */
function isLive(status: string): boolean {
  return status !== "canceled" && status !== "inactive";
}

export function StripeCardsPanel() {
  const [cards, setCards] = useState<StripeCardRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .listStripeCards()
      .then(setCards)
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setCards([]);
      });
  }, []);

  if (!cards) {
    return (
      <Crossfade viewKey="loading">
        <Card>
          <div className="flex items-center gap-2 px-5 py-12 text-body text-muted">
            <Loader2 className="h-4 w-4 animate-spin text-accent-bright" strokeWidth={1.75} />
            Loading cards…
          </div>
        </Card>
      </Crossfade>
    );
  }

  const live = cards.filter((card) => isLive(card.status));
  const committed = live.reduce((sum, card) => sum + (card.monthlyLimitMinor ?? 0), 0);

  if (cards.length === 0) {
    return (
      <Crossfade viewKey="empty">
        <Card>
          <div className="flex flex-col items-center gap-2 px-5 py-14 text-center">
            <CreditCard className="h-5 w-5 text-muted" strokeWidth={1.75} />
            <div className="text-body text-muted">No cards issued.</div>
            <p className="max-w-sm text-label text-muted">
              {error
                ? "Connect Stripe to issue virtual cards."
                : "Issuing a card requires a card budget — a rail with no limit does not spend."}
            </p>
          </div>
        </Card>
      </Crossfade>
    );
  }

  return (
    <Crossfade viewKey="cards" className="space-y-3">
      <Card elevation={0} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="text-label text-foreground-secondary">
          <span className="font-medium text-foreground">{formatMoney(committed, "USD")}</span> of
          monthly authority across {live.length} live card{live.length === 1 ? "" : "s"}
        </div>
        <div className="text-micro text-muted">Counted against the card budget</div>
      </Card>

      {/* Cards are issued and retired while this page is open, so the grid is
          a live list rather than a fixed one. */}
      <AnimatedList className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {cards.map((card) => {
          const liveCard = isLive(card.status);
          return (
            <AnimatedItem key={card.cardId}>
            <Card elevation={liveCard ? 1 : 0} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04]">
                    <CreditCard
                      className={`h-4 w-4 ${liveCard ? "text-accent-bright" : "text-muted"}`}
                      strokeWidth={1.75}
                    />
                  </div>
                  <div>
                    <div className="text-body font-medium text-foreground">{card.purposeLabel}</div>
                    <div className="text-micro text-muted">
                      {card.brand} ···· {card.last4}
                    </div>
                  </div>
                </div>
                {/* A card can be frozen or cancelled from Stripe's side, so
                    this badge changes without anyone touching this page. */}
                <Crossfade viewKey={card.status} className="shrink-0">
                  <Badge tone={liveCard ? "success" : "neutral"} dot={liveCard}>
                    {card.status}
                  </Badge>
                </Crossfade>
              </div>

              <div className="mt-3 text-label text-foreground-secondary">
                {card.monthlyLimitMinor === null ? (
                  // Honest about the gap rather than showing a confident zero.
                  <span className="text-muted">
                    Issued before limits were recorded — counts as zero against the budget.
                  </span>
                ) : (
                  <>
                    {formatMoney(card.monthlyLimitMinor, "USD")}
                    <span className="text-muted"> a month</span>
                  </>
                )}
              </div>
            </Card>
            </AnimatedItem>
          );
        })}
      </AnimatedList>
    </Crossfade>
  );
}
