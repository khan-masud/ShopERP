import { Card } from "@/components/ui/Card";

type StatCardProps = {
  title: string;
  value: string;
  accent?: "blue" | "green" | "orange" | "red";
  hint?: string;
};

const accentClass = {
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  orange: "bg-amber-500",
  red: "bg-red-500",
};

export function StatCard({ title, value, accent = "blue", hint }: StatCardProps) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">{value}</p>
          {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
        </div>
        <span className={`mt-1 h-2.5 w-2.5 rounded-full ${accentClass[accent]}`} />
      </div>
    </Card>
  );
}
