"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Check, CircleAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  getBusinessSettings,
  putBusinessSettings,
  checkGstin,
  type BusinessSettings,
  type GstinCheck,
} from "@/lib/api";

export function BusinessSettingsCard() {
  const [data, setData] = useState<BusinessSettings | null>(null);
  const [registration, setRegistration] = useState("");
  const [gstin, setGstin] = useState("");
  const [entity, setEntity] = useState("");
  const [check, setCheck] = useState<GstinCheck | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getBusinessSettings()
      .then((d) => {
        setData(d);
        setRegistration(d.gst_registration);
        setGstin(d.gstin);
        setEntity(d.entity_type);
        setCheck(d.gstin.trim() ? d.gstin_check : null);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  // Live GSTIN validation (debounced), only while registered.
  const registered = registration === "regular" || registration === "composition";
  useEffect(() => {
    if (!registered || !gstin.trim()) {
      setCheck(null);
      return;
    }
    const t = setTimeout(() => {
      checkGstin(gstin).then(setCheck).catch(() => setCheck(null));
    }, 400);
    return () => clearTimeout(t);
  }, [gstin, registered]);

  const entityLabel = (key: string) =>
    data?.entity_types.find((e) => e.key === key)?.label ?? key;

  const suggested = check?.valid ? check.entity_type : null;
  const canSuggest = suggested && suggested !== entity;

  const dirty = useMemo(
    () =>
      !!data &&
      (registration !== data.gst_registration ||
        gstin.trim().toUpperCase() !== data.gstin ||
        entity !== data.entity_type),
    [data, registration, gstin, entity],
  );

  const save = async () => {
    setSaving(true);
    try {
      const updated = await putBusinessSettings(registration, gstin, entity);
      setData(updated);
      setGstin(updated.gstin);
      toast.success("Business profile saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold">Business profile</h2>
        <p className="text-xs text-muted-foreground">
          Drives how GST is handled on your invoices and the tax estimate on your P&amp;L.
        </p>
      </div>

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              GST registration
            </label>
            <Select value={registration} onValueChange={(v) => setRegistration(v ?? registration)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {data?.registrations.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Entity type
            </label>
            <Select value={entity} onValueChange={(v) => setEntity(v ?? entity)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {data?.entity_types.map((e) => (
                  <SelectItem key={e.key} value={e.key}>
                    {e.label} · {e.rate_label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {registered && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              GSTIN
            </label>
            <Input
              value={gstin}
              placeholder="e.g. 27AAPFU0939F1ZV"
              className="font-mono uppercase"
              maxLength={15}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
            />
            {gstin.trim() && check && (
              <p
                className={cn(
                  "mt-1.5 flex items-center gap-1.5 text-xs",
                  check.valid ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
                )}
              >
                {check.valid ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Valid GSTIN
                    {check.entity_type && ` · looks like a ${entityLabel(check.entity_type).toLowerCase()}`}
                  </>
                ) : (
                  <>
                    <CircleAlert className="h-3.5 w-3.5" />
                    {check.reason === "checksum mismatch"
                      ? "Checksum doesn't match — re-check the number"
                      : "Not a valid GSTIN format"}
                  </>
                )}
              </p>
            )}
            {canSuggest && (
              <button
                type="button"
                onClick={() => setEntity(suggested!)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary/30 px-2.5 py-1 text-xs text-primary transition-colors hover:bg-primary/5"
              >
                <Sparkles className="h-3 w-3" />
                Set entity to {entityLabel(suggested!)} from GSTIN
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-4 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          Rates as of {data?.rates_as_of ?? "FY 2025-26"} (GST 2.0). Re-check after each Union Budget.
        </p>
        <Button size="sm" onClick={save} disabled={saving || !dirty}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save
        </Button>
      </div>
    </Card>
  );
}
