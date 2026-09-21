"use client";

import { useEffect, useState } from "react";
import { Loader2, Download, Inbox, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { InvoiceRow } from "@/components/invoice-row";
import {
  listInvoices,
  recategorizeInvoices,
  getDuplicates,
  getGstFlags,
  exportCsvUrl,
  type Invoice,
  type DuplicateFlag,
  type GstFlag,
} from "@/lib/api";

export function HistoryView() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [dups, setDups] = useState<Record<number, DuplicateFlag>>({});
  const [gstFlags, setGstFlags] = useState<Record<number, GstFlag>>({});
  const [error, setError] = useState<string | null>(null);
  const [recat, setRecat] = useState(false);

  const refreshGstFlags = () =>
    getGstFlags().then((r) => setGstFlags(r.flags)).catch(() => {});

  useEffect(() => {
    listInvoices()
      .then(setInvoices)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    getDuplicates().then(setDups).catch(() => {});
    refreshGstFlags();
  }, []);

  const handleUpdated = (u: Invoice) => {
    setInvoices((prev) =>
      prev ? prev.map((i) => (i.id === u.id ? u : i)) : prev,
    );
    refreshGstFlags();
  };

  const recategorize = async () => {
    setRecat(true);
    try {
      const res = await recategorizeInvoices();
      setInvoices(await listInvoices());
      toast.success(`Re-categorized ${res.updated} invoice${res.updated === 1 ? "" : "s"}`);
      if (res.errors.length) toast.error(`${res.errors.length} failed`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Re-categorize failed");
    } finally {
      setRecat(false);
    }
  };

  const list = invoices ?? [];
  const approved = list.filter((i) => i.status === "approved").length;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">History</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every invoice you&apos;ve processed. Edit any field, download one, or
            export all approved.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {list.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={recategorize}
              disabled={recat}
            >
              {recat ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Re-categorize with AI
            </Button>
          )}
          {approved > 0 && (
            <a
              href={exportCsvUrl}
              download
              className={buttonVariants({ size: "sm" })}
            >
              <Download className="h-4 w-4" />
              Export approved ({approved})
            </a>
          )}
        </div>
      </header>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!invoices && !error && (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      )}

      {invoices && invoices.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
            <Inbox className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            Nothing processed yet. Head to{" "}
            <span className="text-foreground">Invoices</span> to upload.
          </p>
        </div>
      )}

      {invoices && invoices.length > 0 && (
        <div className="space-y-2">
          {invoices.map((inv) => (
            <InvoiceRow
              key={inv.id}
              inv={inv}
              onUpdated={handleUpdated}
              duplicate={dups[inv.id]}
              gstFlag={gstFlags[inv.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
