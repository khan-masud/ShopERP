"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";

const lowStockDismissKey = "shoperp.warning.dismiss.low";
const outOfStockDismissKey = "shoperp.warning.dismiss.out";

type StockWarningItem = {
  id: string;
  name: string;
  stock: number;
  min_stock: number;
};

function buildNamesText(items: StockWarningItem[]) {
  return items
    .map((item) => `${item.name} (${item.stock})`)
    .join(", ");
}

function buildSignature(items: StockWarningItem[]) {
  return [...items]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => `${item.id}:${item.stock}:${item.min_stock}`)
    .join("|");
}

function readSessionValue(key: string) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionValue(key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Ignore storage write errors.
  }
}

export function StockWarnings({
  lowStockProducts,
  outOfStockProducts,
}: {
  lowStockProducts: StockWarningItem[];
  outOfStockProducts: StockWarningItem[];
}) {
  const lowSignature = useMemo(() => buildSignature(lowStockProducts), [lowStockProducts]);
  const outSignature = useMemo(() => buildSignature(outOfStockProducts), [outOfStockProducts]);

  const isHydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const persistedLowSignature = isHydrated ? readSessionValue(lowStockDismissKey) : null;
  const persistedOutSignature = isHydrated ? readSessionValue(outOfStockDismissKey) : null;

  const [dismissedLowOverride, setDismissedLowOverride] = useState<string | null>(null);
  const [dismissedOutOverride, setDismissedOutOverride] = useState<string | null>(null);

  const dismissedLowSignature = dismissedLowOverride ?? persistedLowSignature;
  const dismissedOutSignature = dismissedOutOverride ?? persistedOutSignature;

  function dismissLowStockWarning() {
    setDismissedLowOverride(lowSignature);
    writeSessionValue(lowStockDismissKey, lowSignature);
  }

  function dismissOutOfStockWarning() {
    setDismissedOutOverride(outSignature);
    writeSessionValue(outOfStockDismissKey, outSignature);
  }

  const showLowStock = lowStockProducts.length > 0 && dismissedLowSignature !== lowSignature;
  const showOutOfStock = outOfStockProducts.length > 0 && dismissedOutSignature !== outSignature;

  if (lowStockProducts.length === 0 && outOfStockProducts.length === 0) {
    return null;
  }

  if (!isHydrated) {
    return null;
  }

  return (
    <div className="space-y-3">
      {showOutOfStock && outOfStockProducts.length > 0 ? (
        <div className="rounded-xl border border-red-300 bg-red-100 px-4 py-3 text-red-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Out of Stock Warning ({outOfStockProducts.length})</p>
              <p className="mt-1 text-xs leading-relaxed">{buildNamesText(outOfStockProducts)}</p>
            </div>

            <button
              type="button"
              onClick={dismissOutOfStockWarning}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-red-300 bg-white/70 text-red-700 hover:bg-white"
              aria-label="Close out of stock warning"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ) : null}

      {showLowStock && lowStockProducts.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-100 px-4 py-3 text-amber-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Low Stock Warning ({lowStockProducts.length})</p>
              <p className="mt-1 text-xs leading-relaxed">{buildNamesText(lowStockProducts)}</p>
            </div>

            <button
              type="button"
              onClick={dismissLowStockWarning}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-amber-300 bg-white/70 text-amber-700 hover:bg-white"
              aria-label="Close low stock warning"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
