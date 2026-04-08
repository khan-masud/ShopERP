"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";
import { Bell, LogOut, UserCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { AppUser } from "@/types/auth";

export function Topbar({ user }: { user: AppUser }) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    try {
      setIsLoggingOut(true);
      const res = await fetch("/api/auth/logout", {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error("Logout failed");
      }

      toast.success("Successfully logged out");
      router.replace("/login");
      router.refresh();
    } catch {
      toast.error("Logout failed. Please try again.");
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="flex h-16 items-center justify-between gap-3 px-4 lg:px-6">
        <div>
          <h1 className="text-sm font-semibold text-slate-900">ShopERP Operations Center</h1>
          <p className="text-xs text-slate-500">Real-time retail operations</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100"
            aria-label="Notifications"
          >
            <Bell size={16} />
          </button>

          <div className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 sm:flex">
            <UserCircle2 size={16} className="text-slate-600" />
            <div className="leading-tight">
              <p className="text-xs font-semibold text-slate-900">{user.name}</p>
              <p className="text-[11px] text-slate-500">{user.role.toUpperCase()}</p>
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="gap-1.5"
          >
            <LogOut size={14} />
            <span className="hidden sm:inline">Logout</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
