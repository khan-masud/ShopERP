"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

type ShortcutConfig = {
  id: string;
  label: string;
  description: string;
  href: string;
  key: string;
  hotkey: string;
};

const shortcuts: ShortcutConfig[] = [
  {
    id: "new-sale",
    label: "New Sale",
    description: "Open POS checkout",
    href: "/pos",
    key: "n",
    hotkey: "Alt+N",
  },
  {
    id: "add-product",
    label: "Add Product",
    description: "Go to products module",
    href: "/products",
    key: "p",
    hotkey: "Alt+P",
  },
  {
    id: "edit-stock",
    label: "Update Stock",
    description: "Open stock management",
    href: "/stock",
    key: "k",
    hotkey: "Alt+K",
  },
  {
    id: "sales-history",
    label: "Sales History",
    description: "Inspect sell and due status",
    href: "/sales",
    key: "h",
    hotkey: "Alt+H",
  },
];

export function DashboardShortcuts() {
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTypingTarget =
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        Boolean(target?.isContentEditable);

      if (isTypingTarget) {
        return;
      }

      const key = event.key.toLowerCase();
      const shortcut = shortcuts.find((item) => item.key === key);

      if (!shortcut) {
        return;
      }

      event.preventDefault();
      router.push(shortcut.href);
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [router]);

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        {shortcuts.map((shortcut) => (
          <div key={shortcut.id} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{shortcut.label}</p>
                <p className="mt-1 text-xs text-slate-500">{shortcut.description}</p>
              </div>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                {shortcut.hotkey}
              </span>
            </div>

            <Button
              className="mt-3 w-full"
              variant="secondary"
              size="sm"
              onClick={() => router.push(shortcut.href)}
            >
              Open
            </Button>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-500">
        Keyboard shortcuts work inside dashboard view only and do not trigger while typing in input fields.
      </p>
    </div>
  );
}
