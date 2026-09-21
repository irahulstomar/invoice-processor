"use client";

import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  LayoutGrid,
  Clock,
  TrendingUp,
  Settings,
  Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type View = "overview" | "process" | "history" | "pnl" | "settings";

const NAV: { id: View; label: string; icon: typeof LayoutGrid }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "process", label: "Invoices", icon: LayoutGrid },
  { id: "history", label: "History", icon: Clock },
  { id: "pnl", label: "P&L", icon: TrendingUp },
  { id: "settings", label: "Settings", icon: Settings },
];

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function AppSidebar({
  active,
  onSelect,
}: {
  active: View;
  onSelect: (v: View) => void;
}) {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const ping = () =>
      fetch(`${BASE}/health`)
        .then((r) => alive && setOnline(r.ok))
        .catch(() => alive && setOnline(false));
    ping();
    const t = setInterval(ping, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="px-5 py-5">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/slate-mark.png" alt="" className="h-7 w-7 shrink-0" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/slate-word.png" alt="Slate" className="h-[22px] w-auto" />
        </div>
        <p className="mt-2 text-[11px] leading-tight text-sidebar-foreground">
          AI for finance. Clarity for business.
        </p>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        <p className="px-2 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
          Workspace
        </p>
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active === id
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="h-[18px] w-[18px]" />
            {label}
          </button>
        ))}

        <p className="px-2 pb-1 pt-5 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
          Coming soon
        </p>
        <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/50">
          <Sparkles className="h-[18px] w-[18px]" />
          Assistant
          <span className="ml-auto rounded-full border border-sidebar-border px-1.5 py-0.5 text-[10px] font-normal">
            Soon
          </span>
        </div>
      </nav>

      <div className="border-t border-sidebar-border px-5 py-4">
        <div className="flex items-center gap-2 text-xs text-sidebar-foreground">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              online === null
                ? "bg-muted-foreground"
                : online
                  ? "bg-emerald-500"
                  : "bg-destructive",
            )}
          />
          {online === null
            ? "Checking backend…"
            : online
              ? "Backend connected"
              : "Backend offline"}
        </div>
      </div>
    </aside>
  );
}
