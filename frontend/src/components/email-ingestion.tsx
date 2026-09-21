"use client";

import { useEffect, useState } from "react";
import { Loader2, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  getEmailSettings,
  putEmailSettings,
  pollEmail,
  type EmailSettings,
} from "@/lib/api";

const MIN_INTERVAL = 30;

export function EmailIngestion() {
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [intervalText, setIntervalText] = useState("300");
  const [saving, setSaving] = useState(false);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    getEmailSettings()
      .then((s) => {
        setSettings(s);
        setIntervalText(String(s.interval_seconds));
      })
      .catch(() => setSettings(null));
  }, []);

  const save = async (auto: boolean, interval: number) => {
    setSaving(true);
    try {
      const updated = await putEmailSettings(auto, interval);
      setSettings(updated);
      setIntervalText(String(updated.interval_seconds));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const commitInterval = () => {
    if (!settings) return;
    const parsed = Math.max(MIN_INTERVAL, parseInt(intervalText, 10) || MIN_INTERVAL);
    save(settings.auto_enabled, parsed);
  };

  const pollNow = async () => {
    setPolling(true);
    try {
      const result = await pollEmail();
      if (result.invoices.length)
        toast.success(`Pulled ${result.invoices.length} invoice(s) from email`);
      else toast.info("No new invoice emails found");
      if (result.errors.length)
        toast.error(`${result.errors.length} attachment(s) failed`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Poll failed");
    } finally {
      setPolling(false);
    }
  };

  const connected = settings?.authed ?? false;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Email ingestion</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Auto-pull invoice attachments from Gmail into the review queue.
          </p>
        </div>
        <span
          className={
            connected
              ? "flex items-center gap-1.5 text-xs text-emerald-500"
              : "flex items-center gap-1.5 text-xs text-muted-foreground"
          }
        >
          <span
            className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-muted-foreground"}`}
          />
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>

      {!connected && (
        <p className="mb-4 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          To connect: add <span className="font-mono">credentials.json</span> to{" "}
          <span className="font-mono">backend/</span> and run{" "}
          <span className="font-mono">python gmail_auth.py</span> once.
        </p>
      )}

      <div className="divide-y divide-border">
        <div className="flex items-center justify-between py-3.5">
          <div>
            <Label htmlFor="auto-poll" className="text-sm">
              Automatic polling
            </Label>
            <p className="text-xs text-muted-foreground">
              Check for new emails on a timer.
            </p>
          </div>
          <Switch
            id="auto-poll"
            checked={settings?.auto_enabled ?? false}
            disabled={!settings || saving}
            onCheckedChange={(v) =>
              settings && save(v, settings.interval_seconds)
            }
          />
        </div>

        {settings?.auto_enabled && (
          <div className="flex items-center justify-between py-3.5">
            <div>
              <Label htmlFor="interval" className="text-sm">
                Poll every
              </Label>
              <p className="text-xs text-muted-foreground">
                Seconds between checks (min {MIN_INTERVAL}).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="interval"
                className="w-24 text-right"
                inputMode="numeric"
                value={intervalText}
                onChange={(e) => setIntervalText(e.target.value)}
                onBlur={commitInterval}
                onKeyDown={(e) => e.key === "Enter" && commitInterval()}
              />
              <span className="text-xs text-muted-foreground">sec</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between py-3.5">
          <div>
            <p className="text-sm">Manual poll</p>
            <p className="text-xs text-muted-foreground">
              {settings?.last_poll
                ? `Last polled ${new Date(settings.last_poll).toLocaleTimeString()}`
                : "Pull now, regardless of the timer."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={pollNow}
            disabled={!connected || polling}
          >
            {polling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Poll inbox now
          </Button>
        </div>
      </div>
    </Card>
  );
}
