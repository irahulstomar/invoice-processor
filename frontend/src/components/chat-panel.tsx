"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, X, Send, Loader2, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { chatQuery, type ChatMessage } from "@/lib/api";

const SUGGESTIONS = [
  "Who is my biggest vendor?",
  "How much did I spend on marketing?",
  "Which invoices are over ₹50,000?",
  "What was my profit in 2026?",
];

export function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || sending) return;
    const history = messages;
    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setSending(true);
    try {
      const answer = await chatQuery(question, history);
      setMessages((m) => [...m, { role: "assistant", content: answer }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: e instanceof Error ? e.message : "Something went wrong." },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Floating launcher — hidden while open (close lives in the header, so it can't overlap Send) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
          aria-label="Ask about your finances"
        >
          <MessageSquare className="h-5 w-5" />
        </button>
      )}

      {/* Slide-over */}
      <div
        className={cn(
          "fixed right-0 top-0 z-30 flex h-screen w-full max-w-[420px] flex-col border-l border-border bg-card shadow-2xl transition-transform duration-300",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <Sparkles className="h-4 w-4 text-primary" />
          <div className="leading-tight">
            <p className="text-sm font-semibold">Ask your finances</p>
            <p className="text-[11px] text-muted-foreground">
              Answers come from your invoice data
            </p>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close chat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {messages.length === 0 && (
            <div className="space-y-3 pt-4">
              <p className="text-sm text-muted-foreground">
                Ask anything about your invoices, vendors, spend or profit. For example:
              </p>
              <div className="flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-lg border border-border px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "flex",
                m.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground",
                )}
              >
                {m.content}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl bg-muted px-3.5 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Thinking…
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder="Ask a question…"
              className="max-h-32 flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <button
              onClick={() => send(input)}
              disabled={sending || !input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
