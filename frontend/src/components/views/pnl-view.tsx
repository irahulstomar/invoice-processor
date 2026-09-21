"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Download, Upload, Plus, Trash2, Info, Check } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UploadZone } from "@/components/upload-zone";
import { MonthYearPicker } from "@/components/month-year-picker";
import { PnlCompare } from "@/components/views/pnl-compare";
import { cn } from "@/lib/utils";
import {
  getPnl,
  getPnlAccounts,
  listPnlEntries,
  addPnlEntry,
  deletePnlEntry,
  approveTaxProvision,
  listInvoices,
  pnlTemplateUrl,
  uploadPnlSheet,
  type PnlStatement,
  type PnlAccount,
  type PnlEntry,
} from "@/lib/api";

function fmt(n: number | null): string {
  if (n === null) return "";
  const abs = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${abs})` : abs;
}

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

type Scope = "month" | "quarter" | "year";

// Turn the selected month + scope into a backend period spec. The statement
// view picks one month; the scope decides whether we aggregate that month, its
// quarter, or its whole year (the backend's expand_period understands all three).
function periodFor(scope: Scope, month: string): string {
  const [y, m] = month.split("-");
  if (scope === "year") return y;
  if (scope === "quarter") return `${y}-Q${Math.floor((Number(m) - 1) / 3) + 1}`;
  return month;
}

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(m: string): string {
  const [y, mm] = m.split("-");
  return `${MONTH_LABELS[Number(mm) - 1]} ${y}`;
}

function yearOptions(selected: string): string[] {
  const y = new Date().getFullYear();
  const base = Array.from({ length: 7 }, (_, i) => String(y + 1 - i));
  return Array.from(new Set([selected, ...base])).sort((a, b) => Number(b) - Number(a));
}

// Period picker that adapts to the chosen scope, so there's never a dropdown
// that doesn't apply: year scope shows only a year, quarter adds a Q1–Q4
// select, month adds a month select. Value is the canonical "YYYY-MM".
function PeriodPicker({
  scope,
  value,
  onChange,
}: {
  scope: Scope;
  value: string;
  onChange: (v: string) => void;
}) {
  const [year, m] = value.split("-");
  const month = m ?? "01";
  const quarter = Math.floor((Number(month) - 1) / 3) + 1;

  return (
    <div className="flex items-center gap-2">
      {scope === "month" && (
        <Select value={month} onValueChange={(v) => onChange(`${year}-${v ?? month}`)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTH_LABELS.map((label, i) => {
              const mm = String(i + 1).padStart(2, "0");
              return (
                <SelectItem key={mm} value={mm}>
                  {label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      )}
      {scope === "quarter" && (
        <Select
          value={String(quarter)}
          onValueChange={(v) =>
            onChange(`${year}-${String((Number(v ?? quarter) - 1) * 3 + 1).padStart(2, "0")}`)
          }
        >
          <SelectTrigger className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4].map((q) => (
              <SelectItem key={q} value={String(q)}>
                Q{q}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select value={year} onValueChange={(v) => onChange(`${v ?? year}-${month}`)}>
        <SelectTrigger className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {yearOptions(year).map((y) => (
            <SelectItem key={y} value={y}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Trim the full template down to lines that actually carry a number, so an
// empty section never shows as a wall of 0.00 rows. Kept here (not in Compare)
// because Compare aligns rows by index across periods and needs every line.
function visibleRows(rows: PnlStatement["rows"]): PnlStatement["rows"] {
  return rows.filter((r, i) => {
    // A subtotal that just repeats the next one (no COGS, no tax, etc.).
    if (r.redundant) return false;
    if (r.amount === null) {
      // Section header: keep only if a following leaf (up to the next
      // subtotal/header) carries a value.
      for (let j = i + 1; j < rows.length; j++) {
        const n = rows[j];
        if (n.amount === null || n.total) break;
        if (n.amount !== 0) return true;
      }
      return false;
    }
    if (r.grand) return r.amount !== 0 || i === rows.length - 1; // bottom lines
    return r.amount !== 0; // leaves & subtotals
  });
}

export function PnlView() {
  const [mode, setMode] = useState<"statement" | "compare">("statement");
  const [scope, setScope] = useState<Scope>("year");
  // `month` drives what the statement shows (its year/quarter/month);
  // `addMonth` is the separate target for adding bills & entries below.
  const [month, setMonth] = useState<string>(thisMonth());
  const [addMonth, setAddMonth] = useState<string>(thisMonth());
  const [statement, setStatement] = useState<PnlStatement | null>(null);
  const [accounts, setAccounts] = useState<PnlAccount[]>([]);
  const [entries, setEntries] = useState<PnlEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);

  // Default both to the latest month that actually has invoices.
  useEffect(() => {
    getPnlAccounts().then(setAccounts).catch(() => {});
    listInvoices()
      .then((invs) => {
        const months = invs
          .map((i) => i.invoice_date?.slice(0, 7))
          .filter((m): m is string => !!m);
        if (months.length) {
          const latest = months.sort().at(-1)!;
          setMonth(latest);
          setAddMonth(latest);
        }
      })
      .catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, e] = await Promise.all([
        getPnl(periodFor(scope, month)),
        listPnlEntries(addMonth),
      ]);
      setStatement(s);
      setEntries(e);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load P&L");
    } finally {
      setLoading(false);
    }
  }, [month, scope, addMonth]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const approveTax = async () => {
    setApproving(true);
    try {
      const res = await approveTaxProvision(periodFor(scope, month));
      toast.success(`Tax provision booked: ${fmt(res.amount)}`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't approve provision");
    } finally {
      setApproving(false);
    }
  };

  const t = statement?.totals;
  const hasData = !!statement?.rows.some(
    (r) => r.amount !== null && r.amount !== 0,
  );

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Profit &amp; Loss</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Statement from your invoices and entries. Amounts are net of tax.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="flex gap-0.5 rounded-md border border-border p-0.5 text-sm">
            <button
              onClick={() => setMode("statement")}
              className={cn(
                "rounded px-3 py-1 transition-colors",
                mode === "statement"
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Statement
            </button>
            <button
              onClick={() => setMode("compare")}
              className={cn(
                "rounded px-3 py-1 transition-colors",
                mode === "compare"
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Compare
            </button>
          </div>
          {mode === "statement" && (
            <>
              <div className="flex gap-0.5 rounded-md border border-border p-0.5 text-sm">
                {(["month", "quarter", "year"] as Scope[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setScope(s)}
                    className={cn(
                      "rounded px-3 py-1 capitalize transition-colors",
                      scope === s
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <PeriodPicker scope={scope} value={month} onChange={setMonth} />
            </>
          )}
        </div>
      </header>

      {mode === "compare" && <PnlCompare />}

      {/* KPI band */}
      {mode === "statement" && t && hasData && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Revenue" value={t.net_sales} />
          <Kpi
            label="Total Expenses"
            value={t.total_cogs + t.total_operating_expenses}
          />
          <Kpi label="Net Profit" value={t.profit} accent />
          <Kpi
            label="Net Margin"
            value={t.net_sales ? (t.profit / t.net_sales) * 100 : 0}
            percent
          />
        </div>
      )}

      {mode === "statement" &&
        (loading && !statement ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        statement && (hasData ? (
          <Card className="p-0">
            <table className="w-full text-sm">
              <tbody>
                {visibleRows(statement.rows).map((r, i) => {
                  if (r.amount === null) {
                    // Section header
                    return (
                      <tr key={i}>
                        <td
                          colSpan={2}
                          className="px-5 pb-1 pt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          {r.label}
                        </td>
                      </tr>
                    );
                  }
                  const negative = r.amount < 0;
                  const row = (
                    <tr
                      key={i}
                      className={cn(
                        r.total && "border-t border-border",
                        r.grand && "bg-muted/30",
                      )}
                    >
                      <td
                        className={cn(
                          "px-5 py-1.5",
                          r.total ? "font-semibold" : "pl-8 text-muted-foreground",
                          r.grand && "py-2 text-foreground",
                        )}
                      >
                        {r.label}
                      </td>
                      <td
                        className={cn(
                          "px-5 py-1.5 text-right tabular-nums",
                          r.total ? "font-semibold" : "text-foreground",
                          r.grand && "py-2",
                          negative && "text-destructive",
                        )}
                      >
                        {fmt(r.amount)}
                      </td>
                    </tr>
                  );
                  if (r.estimated && statement.tax_detail) {
                    const d = statement.tax_detail;
                    return (
                      <Fragment key={i}>
                        {row}
                        <tr>
                          <td colSpan={2} className="px-5 pb-2">
                            <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                              <div className="flex items-start gap-2">
                                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <p>
                                  Estimated at{" "}
                                  <span className="font-medium text-foreground">
                                    {d.rate_label}
                                  </span>{" "}
                                  ({d.entity_label}) on {fmt(d.pbt)} profit before
                                  tax. An estimate until your return is filed —
                                  review and approve to book it. Rates as of{" "}
                                  {d.rates_as_of}.
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={approveTax}
                                disabled={approving}
                                className="shrink-0"
                              >
                                {approving ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Check className="h-4 w-4" />
                                )}
                                Approve
                              </Button>
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  }
                  return row;
                })}
              </tbody>
            </table>
          </Card>
        ) : (
          <Card className="flex flex-col items-center justify-center gap-1 px-6 py-16 text-center">
            <p className="text-sm font-medium">No data for {statement.label} yet</p>
            <p className="text-sm text-muted-foreground">
              Upload invoices or add entries below to build the statement.
            </p>
          </Card>
        ))
      ))}

      {/* Inputs */}
      {mode === "statement" && (
      <section className="mt-10 space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground">Add data</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-5">
            <h3 className="mb-1 text-sm font-semibold">Bills received</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              Purchase invoices → expenses. Dates are read from each file.
            </p>
            <UploadZone direction="received" onUploaded={refresh} />
          </Card>
          <Card className="p-5">
            <h3 className="mb-1 text-sm font-semibold">Invoices sent</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              Sales invoices → revenue. Dates are read from each file.
            </p>
            <UploadZone direction="sent" onUploaded={refresh} />
          </Card>
        </div>

        <ManualEntry
          month={addMonth}
          onMonthChange={setAddMonth}
          accounts={accounts}
          onAdded={refresh}
        />

        <SheetUpload onDone={refresh} />

        {entries.length > 0 && (
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">
              Manual entries · {monthLabel(addMonth)}
            </h3>
            <ul className="divide-y divide-border">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {accounts.find((a) => a.key === e.pl_account)?.label ??
                        e.pl_account}
                    </p>
                    {e.note && (
                      <p className="truncate text-xs text-muted-foreground">
                        {e.note}
                      </p>
                    )}
                  </div>
                  <span className="text-sm tabular-nums">
                    {fmt(e.amount)}
                  </span>
                  <button
                    onClick={async () => {
                      await deletePnlEntry(e.id);
                      refresh();
                    }}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                    aria-label="Delete entry"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
  percent,
}: {
  label: string;
  value: number;
  accent?: boolean;
  percent?: boolean;
}) {
  const negative = value < 0;
  return (
    <Card className={cn("p-4", accent && "border-primary/30")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-lg font-semibold tabular-nums",
          negative && "text-destructive",
        )}
      >
        {percent ? `${value.toFixed(1)}%` : fmt(value)}
      </p>
    </Card>
  );
}

function ManualEntry({
  month,
  onMonthChange,
  accounts,
  onAdded,
}: {
  month: string;
  onMonthChange: (v: string) => void;
  accounts: PnlAccount[];
  onAdded: () => void;
}) {
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const add = async () => {
    const value = Number(amount);
    if (!account || amount.trim() === "" || Number.isNaN(value)) {
      toast.error("Pick an account and enter an amount");
      return;
    }
    setSaving(true);
    try {
      await addPnlEntry(month, account, value, note);
      setAmount("");
      setNote("");
      onAdded();
      toast.success("Entry added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add entry");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="mb-1 text-sm font-semibold">Manual entry</h3>
          <p className="text-xs text-muted-foreground">
            For lines that aren&apos;t invoices — wages, rent, depreciation, tax…
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Month</span>
          <MonthYearPicker value={month} onChange={onMonthChange} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={account} onValueChange={(v) => setAccount(v ?? "")}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Account" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.key} value={a.key}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="w-32"
          inputMode="decimal"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Input
          className="min-w-40 flex-1"
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <Button size="sm" onClick={add} disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Add
        </Button>
      </div>
    </Card>
  );
}

function SheetUpload({ onDone }: { onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await uploadPnlSheet(file);
      toast.success(`Imported ${res.added} entr${res.added === 1 ? "y" : "ies"}`);
      if (res.errors.length)
        toast.error(`${res.errors.length} row(s) skipped`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sheet upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
      <div>
        <h3 className="text-sm font-semibold">Import from a sheet</h3>
        <p className="text-xs text-muted-foreground">
          Prefer a spreadsheet? Download the template, fill it, upload it back.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <a
          href={pnlTemplateUrl}
          download
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <Download className="h-4 w-4" />
          Template
        </a>
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Upload sheet
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          hidden
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </Card>
  );
}
