// Client for the FastAPI backend.
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type LineItem = {
  description: string;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
};

export type CategoryGuess = {
  category: string;
  confidence: number;
};

export type Invoice = {
  id: number;
  filename: string;
  source: string;
  status: "pending" | "approved";
  direction: "received" | "sent";
  vendor: string | null;
  invoice_date: string | null;
  invoice_number: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  category: string | null;
  category_alternatives: CategoryGuess[];
  line_items: LineItem[];
  confidence: Record<string, number>;
  flagged_fields: string[];
  needs_review: boolean;
  gst_treatment: string | null;
  created_at: string;
};

export type UploadResult = {
  invoices: Invoice[];
  errors: { filename: string; error: string }[];
};

export async function uploadFiles(
  files: File[],
  direction: "received" | "sent" = "received",
): Promise<UploadResult> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  form.append("direction", direction);
  const res = await fetch(`${BASE}/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return res.json();
}

export async function listInvoices(): Promise<Invoice[]> {
  const res = await fetch(`${BASE}/invoices`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load invoices (${res.status})`);
  return (await res.json()).invoices;
}

export async function updateInvoice(
  id: number,
  updates: Partial<Invoice>,
): Promise<Invoice> {
  const res = await fetch(`${BASE}/invoices/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Update failed (${res.status})`);
  return res.json();
}

export type DuplicateFlag = {
  type: "exact" | "potential";
  of_id: number;
  of_date: string;
  vendor: string | null;
  invoice_number: string | null;
  amount: number | null;
  currency: string | null;
  reason: string;
};

export async function getDuplicates(): Promise<Record<number, DuplicateFlag>> {
  const res = await fetch(`${BASE}/invoices/duplicates`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load duplicates (${res.status})`);
  return (await res.json()).duplicates;
}

// A sales invoice with no GST line, where the seller is registered and the
// supply looks taxable: GST is assumed inclusive at the standard rate and
// flagged until the user confirms how to treat it.
export type GstFlag = {
  gst: number;
  base: number;
  rate: number;
};

export async function getGstFlags(): Promise<{
  flags: Record<number, GstFlag>;
  treatments: Record<string, string>;
}> {
  const res = await fetch(`${BASE}/invoices/gst-flags`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load GST flags (${res.status})`);
  return res.json();
}

export async function recategorizeInvoices(): Promise<{
  updated: number;
  errors: { id: number; error: string }[];
}> {
  const res = await fetch(`${BASE}/invoices/recategorize`, { method: "POST" });
  if (!res.ok) throw new Error(`Re-categorize failed (${res.status})`);
  return res.json();
}

export const exportCsvUrl = `${BASE}/export.csv`;

export const invoiceCsvUrl = (id: number) => `${BASE}/invoices/${id}/export.csv`;

export const sessionCsvUrl = (ids: number[]) =>
  `${BASE}/export.csv?ids=${ids.join(",")}`;

export type EmailSettings = {
  auto_enabled: boolean;
  interval_seconds: number;
  configured: boolean;
  authed: boolean;
  last_poll: string | null;
};

export async function getEmailSettings(): Promise<EmailSettings> {
  const res = await fetch(`${BASE}/email/settings`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load email settings (${res.status})`);
  return res.json();
}

export async function putEmailSettings(
  auto_enabled: boolean,
  interval_seconds: number,
): Promise<EmailSettings> {
  const res = await fetch(`${BASE}/email/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auto_enabled, interval_seconds }),
  });
  if (!res.ok) throw new Error(`Failed to save email settings (${res.status})`);
  return res.json();
}

export async function pollEmail(): Promise<UploadResult> {
  const res = await fetch(`${BASE}/email/poll`, { method: "POST" });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ?? `Poll failed (${res.status})`);
  }
  return res.json();
}

// --- Overview: insights + AI finance review ---

export type Insights = {
  period: string;
  label: string;
  prev_label: string;
  currency: string;
  count: number;
  received: number;
  sent: number;
  revenue: number;
  expenses: number;
  profit: number;
  revenue_change: number | null;
  expenses_change: number | null;
  avg_invoice: number;
  needs_review: number;
  missing_info: number;
  duplicates: number;
  gst_payable: number;
  output_tax: number;
  input_tax: number;
  gst_flagged: number;
  gst_assumed: number;
  biggest_expense: { vendor: string | null; amount: number | null } | null;
  top_vendor: { vendor: string; amount: number } | null;
  top_categories: { key: string; label: string; amount: number }[];
  category_changes: { key: string; label: string; pct: number }[];
};

export async function getInsights(period: string): Promise<Insights> {
  const res = await fetch(`${BASE}/insights?period=${period}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load insights (${res.status})`);
  return res.json();
}

export async function getInsightsReview(
  period: string,
): Promise<{ review: string; metrics: Insights }> {
  const res = await fetch(`${BASE}/insights/review?period=${period}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to generate review (${res.status})`);
  return res.json();
}

// --- Chat ---

export type ChatMessage = { role: "user" | "assistant"; content: string };

export async function chatQuery(
  question: string,
  history: ChatMessage[],
): Promise<string> {
  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history }),
  });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d) => d.detail as string | undefined)
      .catch(() => undefined);
    throw new Error(detail ?? `Chat failed (${res.status})`);
  }
  return (await res.json()).answer;
}

// --- Profit & Loss ---

export type PnlRow = {
  key: string | null;
  label: string;
  amount: number | null;
  level: number;
  total: boolean;
  grand: boolean;
  contra: boolean;
  redundant: boolean;
  estimated: boolean;
};

// Present only when the tax line is an estimate (no manual Tax Expense booked).
export type TaxDetail = {
  estimated: boolean;
  rate_label: string;
  entity_label: string;
  pbt: number;
  rates_as_of: string;
};

export type PnlTotals = {
  net_sales: number;
  total_cogs: number;
  gross_profit: number;
  total_operating_expenses: number;
  operating_profit: number;
  other_income: number;
  profit_before_taxes: number;
  tax_expense: number;
  profit: number;
};

export type PnlStatement = {
  period: string;
  label: string;
  rows: PnlRow[];
  totals: PnlTotals;
  tax_detail: TaxDetail | null;
};

export type PnlAccount = {
  key: string;
  label: string;
  section: string;
  contra: boolean;
};

export type PnlEntry = {
  id: number;
  period: string;
  pl_account: string;
  amount: number;
  note: string | null;
  created_at: string;
};

export async function getPnl(period: string): Promise<PnlStatement> {
  const res = await fetch(`${BASE}/pnl?period=${period}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load P&L (${res.status})`);
  return res.json();
}

export async function comparePnl(periods: string[]): Promise<PnlStatement[]> {
  const res = await fetch(`${BASE}/pnl/compare?periods=${periods.join(",")}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load comparison (${res.status})`);
  return (await res.json()).statements;
}

export async function getPnlAccounts(): Promise<PnlAccount[]> {
  const res = await fetch(`${BASE}/pnl/accounts`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load accounts (${res.status})`);
  return (await res.json()).accounts;
}

export async function listPnlEntries(month: string): Promise<PnlEntry[]> {
  const res = await fetch(`${BASE}/pnl/entries?month=${month}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load entries (${res.status})`);
  return (await res.json()).entries;
}

export async function addPnlEntry(
  period: string,
  pl_account: string,
  amount: number,
  note: string,
): Promise<void> {
  const res = await fetch(`${BASE}/pnl/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ period, pl_account, amount, note }),
  });
  if (!res.ok) throw new Error(`Failed to add entry (${res.status})`);
}

export async function deletePnlEntry(id: number): Promise<void> {
  const res = await fetch(`${BASE}/pnl/entries/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete entry (${res.status})`);
}

export async function approveTaxProvision(
  period: string,
): Promise<{ id: number; amount: number; period: string }> {
  const res = await fetch(
    `${BASE}/pnl/tax-provision/approve?period=${period}`,
    { method: "POST" },
  );
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ?? `Failed to approve provision (${res.status})`);
  }
  return res.json();
}

export const pnlTemplateUrl = `${BASE}/pnl/entries/template.csv`;

// --- Business profile (GST registration + entity type) ---

export type EntityOption = { key: string; label: string; rate_label: string };
export type RegistrationOption = { key: string; label: string };
export type GstinCheck = {
  valid: boolean;
  reason: string;
  entity_type: string | null;
};

export type BusinessSettings = {
  gst_registration: string;
  gstin: string;
  entity_type: string;
  gstin_check: GstinCheck;
  entity_types: EntityOption[];
  registrations: RegistrationOption[];
  rates_as_of: string;
};

export async function getBusinessSettings(): Promise<BusinessSettings> {
  const res = await fetch(`${BASE}/settings/business`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load business settings (${res.status})`);
  return res.json();
}

export async function putBusinessSettings(
  gst_registration: string,
  gstin: string,
  entity_type: string,
): Promise<BusinessSettings> {
  const res = await fetch(`${BASE}/settings/business`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gst_registration, gstin, entity_type }),
  });
  if (!res.ok) throw new Error(`Failed to save business settings (${res.status})`);
  return res.json();
}

export async function checkGstin(gstin: string): Promise<GstinCheck> {
  const res = await fetch(
    `${BASE}/settings/gstin-check?gstin=${encodeURIComponent(gstin)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`GSTIN check failed (${res.status})`);
  return res.json();
}

export async function uploadPnlSheet(
  file: File,
): Promise<{ added: number; errors: { row: number; error: string }[] }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/pnl/entries/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`Sheet upload failed (${res.status})`);
  return res.json();
}
