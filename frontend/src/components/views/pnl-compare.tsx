"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, X, BarChart3, LineChart as LineIcon } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
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
import { cn } from "@/lib/utils";
import { MonthYearPicker } from "@/components/month-year-picker";
import { comparePnl, type PnlStatement } from "@/lib/api";

type Gran = "month" | "quarter" | "year";

const METRICS = [
  { key: "net_sales", label: "Net Sales", color: "#6366f1" },
  { key: "gross_profit", label: "Gross Profit", color: "#22c55e" },
  { key: "operating_profit", label: "Operating Profit", color: "#f59e0b" },
  { key: "profit", label: "Net Profit", color: "#06b6d4" },
] as const;

function fmt(n: number | null): string {
  if (n === null) return "";
  const abs = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${abs})` : abs;
}

const compact = (n: number) =>
  Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(0)}k` : `${n}`;

// Year dropdown options: next year down through five years back.
const YEARS = (() => {
  const y = new Date().getFullYear();
  return Array.from({ length: 7 }, (_, i) => String(y + 1 - i));
})();

export function PnlCompare() {
  const [gran, setGran] = useState<Gran>("month");
  const [periods, setPeriods] = useState<string[]>([]);
  const [statements, setStatements] = useState<PnlStatement[]>([]);
  const [loading, setLoading] = useState(false);
  const [chart, setChart] = useState<"bar" | "line">("bar");

  // Builder inputs
  const now = new Date();
  const [monthVal, setMonthVal] = useState(now.toISOString().slice(0, 7));
  const [yearVal, setYearVal] = useState(String(now.getFullYear()));
  const [quarterVal, setQuarterVal] = useState("1");

  useEffect(() => {
    if (periods.length === 0) {
      setStatements([]);
      return;
    }
    setLoading(true);
    comparePnl(periods)
      .then(setStatements)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Compare failed"))
      .finally(() => setLoading(false));
  }, [periods]);

  const addPeriod = () => {
    let spec = "";
    if (gran === "month") spec = monthVal;
    else if (gran === "quarter") spec = `${yearVal}-Q${quarterVal}`;
    else spec = yearVal;
    if (!spec) return;
    if (periods.includes(spec)) {
      toast.info("Already added");
      return;
    }
    setPeriods((p) => [...p, spec]);
  };

  const removePeriod = (spec: string) =>
    setPeriods((p) => p.filter((x) => x !== spec));

  const onGranChange = (g: Gran) => {
    setGran(g);
    setPeriods([]); // periods must all be the same kind
  };

  const chartData = statements.map((s) => {
    const row: Record<string, string | number> = { name: s.label };
    for (const m of METRICS) row[m.label] = s.totals[m.key];
    return row;
  });

  return (
    <div className="space-y-6">
      {/* Builder */}
      <Card className="p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Compare by
            </p>
            <Select value={gran} onValueChange={(v) => onGranChange((v ?? "month") as Gran)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">Month</SelectItem>
                <SelectItem value="quarter">Quarter</SelectItem>
                <SelectItem value="year">Year</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {gran === "month" && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Month</p>
              <MonthYearPicker value={monthVal} onChange={setMonthVal} />
            </div>
          )}

          {gran === "quarter" && (
            <>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Quarter</p>
                <Select value={quarterVal} onValueChange={(v) => setQuarterVal(v ?? "1")}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["1", "2", "3", "4"].map((q) => (
                      <SelectItem key={q} value={q}>
                        Q{q}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Year</p>
                <Select value={yearVal} onValueChange={(v) => setYearVal(v ?? "")}>
                  <SelectTrigger className="w-24">
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
              </div>
            </>
          )}

          {gran === "year" && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Year</p>
              <Select value={yearVal} onValueChange={(v) => setYearVal(v ?? "")}>
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
            </div>
          )}

          <Button size="sm" onClick={addPeriod}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>

        {periods.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {periods.map((p) => (
              <span
                key={p}
                className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 py-1 pl-3 pr-1.5 text-xs"
              >
                {p}
                <button
                  onClick={() => removePeriod(p)}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Remove ${p}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </Card>

      {periods.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          Add two or more {gran}s above to compare them.
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      )}

      {statements.length > 0 && !loading && (
        <>
          {/* Chart */}
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Key metrics</h3>
              <div className="flex gap-1 rounded-md border border-border p-0.5">
                <ChartToggle active={chart === "bar"} onClick={() => setChart("bar")}>
                  <BarChart3 className="h-4 w-4" />
                </ChartToggle>
                <ChartToggle active={chart === "line"} onClick={() => setChart("line")}>
                  <LineIcon className="h-4 w-4" />
                </ChartToggle>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              {chart === "bar" ? (
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#888" }} />
                  <YAxis tickFormatter={compact} tick={{ fontSize: 12, fill: "#888" }} />
                  <Tooltip
                    formatter={(value) => fmt(Number(value))}
                    contentStyle={{
                      background: "#1a1a1a",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {METRICS.map((m) => (
                    <Bar key={m.key} dataKey={m.label} fill={m.color} radius={[3, 3, 0, 0]} />
                  ))}
                </BarChart>
              ) : (
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#888" }} />
                  <YAxis tickFormatter={compact} tick={{ fontSize: 12, fill: "#888" }} />
                  <Tooltip
                    formatter={(value) => fmt(Number(value))}
                    contentStyle={{
                      background: "#1a1a1a",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {METRICS.map((m) => (
                    <Line
                      key={m.key}
                      type="monotone"
                      dataKey={m.label}
                      stroke={m.color}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  ))}
                </LineChart>
              )}
            </ResponsiveContainer>
          </Card>

          {/* Side-by-side table */}
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">
                    Line
                  </th>
                  {statements.map((s) => (
                    <th
                      key={s.period}
                      className="px-5 py-3 text-right text-xs font-medium text-muted-foreground"
                    >
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statements[0].rows.map((r, i) => {
                  if (r.amount === null) {
                    return (
                      <tr key={i}>
                        <td
                          colSpan={statements.length + 1}
                          className="px-5 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          {r.label}
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={i} className={cn(r.total && "border-t border-border", r.grand && "bg-muted/30")}>
                      <td className={cn("px-5 py-1.5", r.total ? "font-semibold" : "pl-8 text-muted-foreground")}>
                        {r.label}
                      </td>
                      {statements.map((s) => {
                        const amt = s.rows[i]?.amount ?? 0;
                        return (
                          <td
                            key={s.period}
                            className={cn(
                              "px-5 py-1.5 text-right tabular-nums",
                              r.total && "font-semibold",
                              amt < 0 && "text-destructive",
                            )}
                          >
                            {fmt(s.rows[i]?.amount ?? null)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

function ChartToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded p-1.5 transition-colors",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
