"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CATEGORIES } from "@/lib/categories";
import { EmailIngestion } from "@/components/email-ingestion";
import { BusinessSettingsCard } from "@/components/business-settings";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </Card>
  );
}

export function SettingsView() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How extraction and export behave.
        </p>
      </header>

      <div className="space-y-4">
        <BusinessSettingsCard />

        <Section
          title="Extraction"
          description="The vision model that reads your documents."
        >
          <Row label="Model" value="Gemini 2.5 Flash" />
          <Row label="Review threshold" value="Confidence < 0.80 flagged" />
          <Row label="Batch upload" value="Enabled" />
        </Section>

        <Section
          title="Backend"
          description="Where the app sends documents for processing."
        >
          <Row
            label="API endpoint"
            value={<span className="font-mono text-xs">{BASE}</span>}
          />
          <Row label="Storage" value="SQLite (local)" />
        </Section>

        <Section
          title="Export"
          description="Format used when exporting approved rows."
        >
          <Row label="Format" value="CSV (QuickBooks / Xero)" />
        </Section>

        <EmailIngestion />

        <Card className="p-5">
          <h2 className="text-sm font-semibold">Chart of accounts</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Categories the AI maps each invoice to.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <Badge key={c} variant="secondary" className="font-normal">
                {c}
              </Badge>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
