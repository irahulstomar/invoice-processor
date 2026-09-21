"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Sparkles,
  Loader2,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Copy,
  FileText,
} from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MonthYearPicker } from "@/components/month-year-picker";
import { cn } from "@/lib/utils";
import { getInsights, getInsightsReview, type Insights } from "@/lib/api";

const YEARS = (() => {
  const y = new Date().getFullYear();
  return Array.from({ length: 7 }, (_, i) => String(y + 1 - i));
})();

function money(n: number | null | undefined, currency = "INR"): string {
  if (n == null) return "—";
  const sym = currency === "INR" ? "₹" : `${currency} `;
  return `${sym}${Math.round(n).toLocaleString("en-IN")}`;
}

export function OverviewView() {
  const [gran, setGran] = useState<"month" | "year">("year");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const period = gran === "year" ? year : month;

  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    setLoading(true);
    setReview(null);
    getInsights(period)
      .then(setData)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [period]);

  const generate = useCallback(async () => {
    setReviewing(true);
    try {
      const r = await getInsightsReview(period);
      setReview(r.review);
      setData(r.metrics);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't generate review");
    } finally {
      setReviewing(false);
    }
  }, [period]);

  const cur = data?.currency ?? "INR";
  const maxCat = Math.max(1, ...(data?.top_categories.map((c) => c.amount) ?? [1]));

  return (
    <div className="mx-auto w-full max-w-4xl">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            An AI read on your books, with the numbers behind it.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-0.5 rounded-md border border-border p-0.5 text-sm">
            {(["month", "year"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGran(g)}
                className={cn(
                  "rounded px-3 py-1 capitalize transition-colors",
                  gran === g
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {g}
              </button>
            ))}
          </div>
          {gran === "month" ? (
            <MonthYearPicker value={month} onChange={setMonth} />
          ) : (
            <Select value={year} onValueChange={(v) => setYear(v ?? year)}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((y) => (
                  <SelectItem key={y} value={y}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </header>

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : data && data.count === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-1 px-6 py-16 text-center">
          <p className="text-sm font-medium">No invoices in {data.label}</p>
          <p className="text-sm text-muted-foreground">
            Process some invoices, then come back for the AI review.
          </p>
        </Card>
      ) : (
        data && (
          <div className="space-y-6">
            {/* AI Finance Review */}
            <Card className="p-6">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">AI Finance Review</h2>
                  <span className="text-xs text-muted-foreground">
                    · {data.count} invoice{data.count === 1 ? "" : "s"} in {data.label}
                  </span>
                </div>
                <Button size="sm" onClick={generate} disabled={reviewing}>
                  {reviewing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {review ? "Regenerate" : "Generate review"}
                </Button>
              </div>
              {review ? (
                <ReviewText text={review} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Generate a plain-English executive summary of {data.label} —
                  revenue, profit, what changed, and what needs attention.
                </p>
              )}
            </Card>

            {/* Headline KPIs */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Revenue" value={money(data.revenue, cur)} change={data.revenue_change} goodUp />
              <Kpi label="Expenses" value={money(data.expenses, cur)} change={data.expenses_change} goodUp={false} />
              <Kpi label="Net Profit" value={money(data.profit, cur)} accent />
              <Kpi label="Avg invoice" value={money(data.avg_invoice, cur)} />
            </div>

            {/* Secondary stats */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat
                icon={<FileText className="h-4 w-4" />}
                label="Biggest supplier"
                value={data.top_vendor?.vendor ?? "—"}
                sub={data.top_vendor ? money(data.top_vendor.amount, cur) : undefined}
              />
              <Stat
                icon={<TrendingUp className="h-4 w-4" />}
                label="Est. GST payable"
                value={money(data.gst_payable, cur)}
                sub={
                  data.gst_flagged
                    ? `incl. ${money(data.gst_assumed, cur)} assumed · ${data.gst_flagged} to review`
                    : `out ${money(data.output_tax, cur)} − in ${money(data.input_tax, cur)}`
                }
                tone={data.gst_flagged ? "warn" : undefined}
              />
              <Stat
                icon={<AlertTriangle className="h-4 w-4" />}
                label="Needs review"
                value={String(data.needs_review)}
                sub={data.missing_info ? `${data.missing_info} missing info` : undefined}
                tone={data.needs_review ? "warn" : undefined}
              />
              <Stat
                icon={<Copy className="h-4 w-4" />}
                label="Duplicates"
                value={String(data.duplicates)}
                tone={data.duplicates ? "bad" : undefined}
              />
            </div>

            {/* Top categories */}
            {data.top_categories.length > 0 && (
              <Card className="p-6">
                <h3 className="mb-4 text-sm font-semibold">Top expense categories</h3>
                <div className="space-y-3">
                  {data.top_categories.map((c) => (
                    <div key={c.key}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span>{c.label}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {money(c.amount, cur)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{ width: `${(c.amount / maxCat) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {data.category_changes.length > 0 && (
                  <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
                    {data.category_changes.map((m) => (
                      <span
                        key={m.key}
                        className={cn(
                          "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                          m.pct >= 0
                            ? "border-amber-500/30 text-amber-600 dark:text-amber-400"
                            : "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
                        )}
                      >
                        {m.pct >= 0 ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        {m.label} {m.pct >= 0 ? "+" : ""}
                        {m.pct}% vs {data.prev_label}
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </div>
        )
      )}
    </div>
  );
}

function ReviewText({ text }: { text: string }) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const bullets = lines.filter((l) => /^[-•]/.test(l)).map((l) => l.replace(/^[-•]\s*/, ""));
  const paras = lines.filter((l) => !/^[-•]/.test(l));
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {paras.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      {bullets.length > 0 && (
        <ul className="space-y-1.5">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-primary">•</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  change,
  goodUp,
  accent,
}: {
  label: string;
  value: string;
  change?: number | null;
  goodUp?: boolean;
  accent?: boolean;
}) {
  const up = (change ?? 0) >= 0;
  const good = goodUp ? up : !up;
  return (
    <Card className={cn("p-4", accent && "border-primary/30")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {change != null && (
        <p
          className={cn(
            "mt-0.5 flex items-center gap-1 text-xs",
            good ? "text-emerald-500" : "text-destructive",
          )}
        >
          {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {up ? "+" : ""}
          {change}%
        </p>
      )}
    </Card>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "warn" | "bad";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <p className="text-xs">{label}</p>
      </div>
      <p
        className={cn(
          "mt-1 truncate text-base font-semibold",
          tone === "warn" && "text-amber-500",
          tone === "bad" && "text-destructive",
        )}
        title={value}
      >
        {value}
      </p>
      {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}
