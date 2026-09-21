"use client";

import { useState } from "react";
import {
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Check,
  Mail,
  Download,
  Copy,
  Receipt,
} from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CATEGORIES } from "@/lib/categories";
import {
  updateInvoice,
  invoiceCsvUrl,
  type Invoice,
  type DuplicateFlag,
  type GstFlag,
} from "@/lib/api";

// One-click resolutions for a sale with no GST line, in the order shown.
const GST_OPTIONS: { key: string; label: string }[] = [
  { key: "inclusive", label: "Inclusive @ 18%" },
  { key: "exempt", label: "Exempt / nil" },
  { key: "zero_rated", label: "Zero-rated (export)" },
  { key: "no_gst", label: "No GST applies" },
];
const GST_LABELS: Record<string, string> = Object.fromEntries(
  GST_OPTIONS.map((o) => [o.key, o.label]),
);

function money(amount: number | null, currency: string | null): string {
  if (amount == null) return "-";
  return `${currency ? currency + " " : ""}${amount.toFixed(2)}`;
}

type Draft = {
  vendor: string;
  invoice_date: string;
  invoice_number: string;
  currency: string;
  subtotal: string;
  tax: string;
  total: string;
  category: string;
};

function toDraft(inv: Invoice): Draft {
  const num = (n: number | null) => (n == null ? "" : String(n));
  return {
    vendor: inv.vendor ?? "",
    invoice_date: inv.invoice_date ?? "",
    invoice_number: inv.invoice_number ?? "",
    currency: inv.currency ?? "",
    subtotal: num(inv.subtotal),
    tax: num(inv.tax),
    total: num(inv.total),
    category: inv.category ?? "",
  };
}

export function InvoiceRow({
  inv,
  onUpdated,
  readOnly = false,
  duplicate,
  gstFlag,
}: {
  inv: Invoice;
  onUpdated?: (updated: Invoice) => void;
  readOnly?: boolean;
  duplicate?: DuplicateFlag;
  gstFlag?: GstFlag;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(inv));
  const [saving, setSaving] = useState<"save" | "approve" | null>(null);
  const [resolvingGst, setResolvingGst] = useState(false);

  const flagged = new Set(inv.flagged_fields);
  const approved = inv.status === "approved";
  const isSale = inv.direction === "sent";

  const resolveGst = async (treatment: string) => {
    setResolvingGst(true);
    try {
      const updated = await updateInvoice(inv.id, { gst_treatment: treatment });
      onUpdated?.(updated);
      setDraft(toDraft(updated));
      toast.success(`GST treatment: ${GST_LABELS[treatment] ?? treatment}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update GST");
    } finally {
      setResolvingGst(false);
    }
  };

  const set = (k: keyof Draft, v: string) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const payload = (extra: Partial<Invoice> = {}): Partial<Invoice> => {
    const numOrNull = (s: string) =>
      s.trim() === "" ? null : Number.isNaN(Number(s)) ? null : Number(s);
    return {
      vendor: draft.vendor,
      invoice_date: draft.invoice_date,
      invoice_number: draft.invoice_number,
      currency: draft.currency,
      subtotal: numOrNull(draft.subtotal),
      tax: numOrNull(draft.tax),
      total: numOrNull(draft.total),
      category: draft.category,
      ...extra,
    };
  };

  const persist = async (mode: "save" | "approve") => {
    setSaving(mode);
    try {
      const updated = await updateInvoice(
        inv.id,
        mode === "approve" ? payload({ status: "approved" }) : payload(),
      );
      onUpdated?.(updated);
      setDraft(toDraft(updated));
      toast.success(mode === "approve" ? "Approved" : "Saved");
      if (mode === "approve") setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card className="overflow-hidden p-0">
      {/* Summary row */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-muted/30"
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium">{inv.vendor || inv.filename}</p>
            {inv.source === "email" && (
              <span className="flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                <Mail className="h-3 w-3" />
                Email
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {inv.invoice_date || "no date"} ·{" "}
            {inv.invoice_number || "no number"}
          </p>
        </div>
        {duplicate && (
          <span
            className={cn(
              "hidden shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline-flex",
              duplicate.type === "exact"
                ? "bg-destructive/15 text-destructive"
                : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
            )}
          >
            <Copy className="h-3 w-3" />
            {duplicate.type === "exact" ? "Duplicate" : "Possible dup"}
          </span>
        )}
        {gstFlag && (
          <span className="hidden shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400 sm:inline-flex">
            <Receipt className="h-3 w-3" />
            Check GST
          </span>
        )}
        {inv.category && (
          <Badge variant="secondary" className="hidden font-normal sm:inline-flex">
            {inv.category}
          </Badge>
        )}
        <div className="w-28 text-right font-medium tabular-nums">
          {money(inv.total, inv.currency)}
        </div>
        <StatusPill approved={approved} needsReview={inv.needs_review} />
      </button>

      {/* Expanded editor */}
      {open && (
        <div className="border-t border-border bg-muted/20 p-4">
          {duplicate && (
            <div
              className={cn(
                "mb-4 flex items-start gap-2 rounded-lg border p-3 text-xs",
                duplicate.type === "exact"
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
              )}
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">
                  {duplicate.type === "exact"
                    ? "Duplicate invoice"
                    : "Possible duplicate"}
                </p>
                <p className="opacity-90">{duplicate.reason}</p>
              </div>
            </div>
          )}
          {isSale && (gstFlag || inv.gst_treatment) && (
            <div
              className={cn(
                "mb-4 rounded-lg border p-3 text-xs",
                gstFlag
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
              )}
            >
              <div className="flex items-start gap-2">
                {gstFlag ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  {gstFlag ? (
                    <>
                      <p className="font-medium">No GST line on this sale</p>
                      <p className="opacity-90">
                        Assuming a GST-inclusive price at {gstFlag.rate}% —{" "}
                        {money(gstFlag.gst, inv.currency)} GST backed out of{" "}
                        {money(inv.total, inv.currency)} (net{" "}
                        {money(gstFlag.base, inv.currency)}). Registered sellers owe
                        GST on taxable sales even when the invoice doesn&apos;t show
                        it. Confirm the treatment:
                      </p>
                    </>
                  ) : (
                    <p className="font-medium">
                      GST treatment: {GST_LABELS[inv.gst_treatment!] ?? inv.gst_treatment}
                    </p>
                  )}
                  {!readOnly && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {GST_OPTIONS.map((o) => {
                        const active = inv.gst_treatment === o.key;
                        return (
                          <button
                            key={o.key}
                            type="button"
                            disabled={resolvingGst || active}
                            onClick={() => resolveGst(o.key)}
                            className={cn(
                              "rounded-full border px-2.5 py-1 font-medium transition-colors",
                              active
                                ? "border-emerald-500/40 bg-emerald-500/10"
                                : "border-current/30 hover:bg-current/5 disabled:opacity-50",
                            )}
                          >
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Vendor" flagged={flagged.has("vendor")}>
              <Input
                value={draft.vendor}
                disabled={readOnly}
                onChange={(e) => set("vendor", e.target.value)}
              />
            </Field>
            <Field label="Category" flagged={flagged.has("category")}>
              <Select
                value={draft.category}
                disabled={readOnly}
                onValueChange={(v) => set("category", v ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <CategoryMeta
                confidence={inv.confidence.category}
                alternatives={inv.category_alternatives}
                disabled={readOnly}
                onPick={(c) => set("category", c)}
              />
            </Field>
            <Field label="Invoice date" flagged={flagged.has("invoice_date")}>
              <Input
                value={draft.invoice_date}
                placeholder="YYYY-MM-DD"
                disabled={readOnly}
                onChange={(e) => set("invoice_date", e.target.value)}
              />
            </Field>
            <Field label="Invoice number" flagged={flagged.has("invoice_number")}>
              <Input
                value={draft.invoice_number}
                disabled={readOnly}
                onChange={(e) => set("invoice_number", e.target.value)}
              />
            </Field>
            <Field label="Subtotal" flagged={flagged.has("subtotal")}>
              <Input
                value={draft.subtotal}
                inputMode="decimal"
                disabled={readOnly}
                onChange={(e) => set("subtotal", e.target.value)}
              />
            </Field>
            <Field label="Tax" flagged={flagged.has("tax")}>
              <Input
                value={draft.tax}
                inputMode="decimal"
                disabled={readOnly}
                onChange={(e) => set("tax", e.target.value)}
              />
            </Field>
            <Field label="Total" flagged={flagged.has("total")}>
              <Input
                value={draft.total}
                inputMode="decimal"
                disabled={readOnly}
                onChange={(e) => set("total", e.target.value)}
              />
            </Field>
            <Field label="Currency" flagged={false}>
              <Input
                value={draft.currency}
                disabled={readOnly}
                onChange={(e) => set("currency", e.target.value)}
              />
            </Field>
          </div>

          {inv.line_items.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Line items
              </p>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <tbody>
                    {inv.line_items.map((li, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-3 py-2">{li.description}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {li.quantity ?? ""}
                          {li.unit_price != null && ` × ${li.unit_price.toFixed(2)}`}
                        </td>
                        <td className="w-24 px-3 py-2 text-right tabular-nums">
                          {li.amount != null ? li.amount.toFixed(2) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <a
              href={invoiceCsvUrl(inv.id)}
              download
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              <Download className="h-4 w-4" />
              CSV
            </a>
            {!readOnly && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => persist("save")}
                  disabled={saving !== null}
                >
                  {saving === "save" && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save
                </Button>
                <Button
                  size="sm"
                  onClick={() => persist("approve")}
                  disabled={saving !== null || approved}
                >
                  {saving === "approve" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  {approved ? "Approved" : "Approve"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function CategoryMeta({
  confidence,
  alternatives,
  disabled,
  onPick,
}: {
  confidence: number | undefined;
  alternatives: { category: string; confidence: number }[];
  disabled: boolean;
  onPick: (category: string) => void;
}) {
  const pct = (c: number) => `${Math.round(c * 100)}%`;
  const color = (c: number) =>
    c >= 0.8 ? "text-emerald-500" : c >= 0.6 ? "text-amber-500" : "text-destructive";
  if (confidence == null && alternatives.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {confidence != null && (
        <p className="text-[11px] text-muted-foreground">
          AI confidence{" "}
          <span className={cn("font-medium", color(confidence))}>{pct(confidence)}</span>
        </p>
      )}
      {alternatives.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Or:</span>
          {alternatives.map((a) => (
            <button
              key={a.category}
              type="button"
              disabled={disabled}
              onClick={() => onPick(a.category)}
              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
            >
              {a.category} · {pct(a.confidence)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  flagged,
  children,
}: {
  label: string;
  flagged: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(flagged && "rounded-lg")}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          {label}
        </label>
        {flagged && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-amber-500">
            <AlertTriangle className="h-3 w-3" />
            low confidence
          </span>
        )}
      </div>
      <div className={cn(flagged && "rounded-md ring-1 ring-amber-500/40")}>
        {children}
      </div>
    </div>
  );
}

function StatusPill({
  approved,
  needsReview,
}: {
  approved: boolean;
  needsReview: boolean;
}) {
  if (approved)
    return (
      <span className="flex w-24 items-center justify-end gap-1 text-xs text-emerald-500">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Approved
      </span>
    );
  if (needsReview)
    return (
      <span className="flex w-24 items-center justify-end gap-1 text-xs text-amber-500">
        <AlertTriangle className="h-3.5 w-3.5" />
        Review
      </span>
    );
  return (
    <span className="flex w-24 items-center justify-end gap-1 text-xs text-muted-foreground">
      <CheckCircle2 className="h-3.5 w-3.5" />
      Clean
    </span>
  );
}
