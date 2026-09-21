"use client";

import { useCallback, useRef, useState } from "react";
import {
  UploadCloud,
  FileText,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFiles, type Invoice } from "@/lib/api";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp";
const ACCEPTED_LABEL = "PDF, PNG, JPG, WEBP";

type Queued = {
  id: string;
  file: File;
  status: "queued" | "uploading" | "done" | "error";
  message?: string;
};

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadZone({
  onUploaded,
  compact = false,
  direction = "received",
}: {
  onUploaded: (invoices: Invoice[]) => void;
  compact?: boolean;
  direction?: "received" | "sent";
}) {
  const [items, setItems] = useState<Queued[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const next: Queued[] = Array.from(files).map((file) => ({
      id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
      file,
      status: "queued",
    }));
    setItems((prev) => [...prev, ...next]);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const removeItem = (id: string) =>
    setItems((prev) => prev.filter((i) => i.id !== id));

  const handleUpload = async () => {
    const pending = items.filter((i) => i.status === "queued");
    if (pending.length === 0) return;
    setBusy(true);
    setItems((prev) =>
      prev.map((i) =>
        i.status === "queued" ? { ...i, status: "uploading" } : i,
      ),
    );
    try {
      const result = await uploadFiles(pending.map((i) => i.file), direction);
      const failedNames = new Map(
        result.errors.map((e) => [e.filename, e.error]),
      );
      setItems((prev) =>
        prev.map((i) => {
          if (i.status !== "uploading") return i;
          const err = failedNames.get(i.file.name);
          return err
            ? { ...i, status: "error", message: err }
            : { ...i, status: "done" };
        }),
      );
      if (result.invoices.length) {
        onUploaded(result.invoices);
        toast.success(
          `Extracted ${result.invoices.length} document${result.invoices.length > 1 ? "s" : ""}`,
        );
      }
      if (result.errors.length) {
        toast.error(`${result.errors.length} file(s) couldn't be processed`);
      }
    } catch (err) {
      setItems((prev) =>
        prev.map((i) =>
          i.status === "uploading"
            ? { ...i, status: "error", message: "Request failed" }
            : i,
        ),
      );
      toast.error(
        err instanceof Error ? err.message : "Upload failed. Is the backend running?",
      );
    } finally {
      setBusy(false);
    }
  };

  const hasQueued = items.some((i) => i.status === "queued");

  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "cursor-pointer rounded-xl border-2 border-dashed transition-colors",
          compact
            ? "flex items-center justify-center gap-2 px-4 py-3 text-sm"
            : "flex flex-col items-center justify-center gap-3 px-6 py-14 text-center",
          dragging
            ? "border-primary bg-primary/10"
            : "border-muted-foreground/30 bg-muted/20 hover:border-muted-foreground/50 hover:bg-muted/40",
        )}
      >
        {compact ? (
          <>
            <Plus className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">Add more invoices</span>
            <span className="text-xs text-muted-foreground">
              drag &amp; drop or choose files
            </span>
          </>
        ) : (
          <>
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
              <UploadCloud className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">
                Drag &amp; drop or{" "}
                <span className="text-primary underline-offset-4 hover:underline">
                  choose file(s)
                </span>{" "}
                to upload
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Invoices &amp; receipts · {ACCEPTED_LABEL} · batch supported
              </p>
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                <FileText className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {prettySize(item.file.size)}
                  {item.message ? ` · ${item.message}` : ""}
                </p>
              </div>
              <StatusBadge status={item.status} />
              {item.status === "queued" && (
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Remove"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => setItems([])}
            disabled={busy}
          >
            Clear
          </Button>
          <Button onClick={handleUpload} disabled={!hasQueued || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Extracting…" : "Upload & extract"}
          </Button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Queued["status"] }) {
  if (status === "uploading")
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Extracting
      </span>
    );
  if (status === "done")
    return (
      <span className="flex items-center gap-1.5 text-xs text-emerald-500">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Done
      </span>
    );
  if (status === "error")
    return (
      <span className="flex items-center gap-1.5 text-xs text-destructive">
        <AlertCircle className="h-3.5 w-3.5" />
        Failed
      </span>
    );
  return <span className="text-xs text-muted-foreground">Queued</span>;
}
