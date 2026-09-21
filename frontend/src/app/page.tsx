"use client";

import { useState } from "react";

import { AppSidebar, type View } from "@/components/app-sidebar";
import { OverviewView } from "@/components/views/overview-view";
import { ProcessView } from "@/components/views/process-view";
import { HistoryView } from "@/components/views/history-view";
import { PnlView } from "@/components/views/pnl-view";
import { SettingsView } from "@/components/views/settings-view";
import { ChatPanel } from "@/components/chat-panel";

export default function Home() {
  const [view, setView] = useState<View>("overview");

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar active={view} onSelect={setView} />
      <main className="flex-1 overflow-y-auto px-8 py-12">
        {view === "overview" && <OverviewView />}
        {view === "process" && <ProcessView />}
        {view === "history" && <HistoryView />}
        {view === "pnl" && <PnlView />}
        {view === "settings" && <SettingsView />}
      </main>
      <ChatPanel />
    </div>
  );
}
