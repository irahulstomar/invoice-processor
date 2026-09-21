"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Next year down through five years back.
const YEARS = (() => {
  const y = new Date().getFullYear();
  return Array.from({ length: 7 }, (_, i) => String(y + 1 - i));
})();

/** Month + year dropdowns over a "YYYY-MM" value. No typing. */
export function MonthYearPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [year, month] = value.split("-");
  // Keep the current year selectable even if it falls outside the default range.
  const years = Array.from(new Set([...(year ? [year] : []), ...YEARS])).sort(
    (a, b) => Number(b) - Number(a),
  );

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Select value={month} onValueChange={(v) => onChange(`${year}-${v ?? month}`)}>
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MONTHS.map((label, i) => {
            const m = String(i + 1).padStart(2, "0");
            return (
              <SelectItem key={m} value={m}>
                {label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <Select value={year} onValueChange={(v) => onChange(`${v ?? year}-${month}`)}>
        <SelectTrigger className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={y}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
