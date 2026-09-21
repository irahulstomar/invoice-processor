"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { UploadZone } from "@/components/upload-zone";
import { InvoiceRow } from "@/components/invoice-row";
import { buttonVariants } from "@/components/ui/button";
import {
  sessionCsvUrl,
  getDuplicates,
  getGstFlags,
  type Invoice,
  type DuplicateFlag,
  type GstFlag,
} from "@/lib/api";

export function ProcessView() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [dups, setDups] = useState<Record<number, DuplicateFlag>>({});
  const [gstFlags, setGstFlags] = useState<Record<number, GstFlag>>({});

  const refreshFlags = () => {
    getDuplicates().then(setDups).catch(() => {});
    getGstFlags().then((r) => setGstFlags(r.flags)).catch(() => {});
  };

  const upsert = (incoming: Invoice[]) => {
    setInvoices((prev) => {
      const byId = new Map(prev.map((i) => [i.id, i]));
      for (const inv of incoming) byId.set(inv.id, inv);
      return [...byId.values()].sort((a, b) => b.id - a.id);
    });
    refreshFlags();
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Process invoices</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop invoices &amp; receipts in, review what comes back, then approve.
          Everything you process is saved to History.
        </p>
      </header>

      <div className="space-y-4">
        <UploadZone onUploaded={upsert} compact={invoices.length > 0} />

        {invoices.length > 0 && (
          <section>
            <div className="mb-3 flex items-center justify-between gap-4">
              <h2 className="text-sm font-medium text-muted-foreground">
                Processed this session ({invoices.length})
              </h2>
              <a
                href={sessionCsvUrl(invoices.map((i) => i.id))}
                download
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <Download className="h-4 w-4" />
                Download CSV
              </a>
            </div>
            <div className="space-y-2">
              {invoices.map((inv) => (
                <InvoiceRow
                  key={inv.id}
                  inv={inv}
                  onUpdated={(u) => upsert([u])}
                  duplicate={dups[inv.id]}
                  gstFlag={gstFlags[inv.id]}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
