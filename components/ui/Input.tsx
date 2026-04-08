import { clsx } from "clsx";
import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
};

export function Input({ label, className, error, ...props }: InputProps) {
  return (
    <label className="flex w-full flex-col gap-1.5">
      {label ? <span className="text-xs font-medium text-slate-600">{label}</span> : null}
      <input
        className={clsx(
          "h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900",
          "placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100",
          error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : "",
          className,
        )}
        {...props}
      />
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </label>
  );
}
