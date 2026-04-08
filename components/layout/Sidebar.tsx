"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Boxes,
  ClipboardList,
  FileClock,
  HandCoins,
  LayoutDashboard,
  ReceiptText,
  Settings2,
  Shield,
  ShoppingCart,
  Users,
} from "lucide-react";
import { clsx } from "clsx";
import type { AppUser } from "@/types/auth";

const bottomNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pos", label: "POS", icon: ShoppingCart },
  { href: "/products", label: "Products", icon: ClipboardList },
  { href: "/sales", label: "Sales", icon: ReceiptText },
];

export function Sidebar({ user }: { user: AppUser }) {
  const pathname = usePathname();
  const menuItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/pos", label: "New Sale", icon: ShoppingCart },
    { href: "/products", label: "Products", icon: Boxes },
    { href: "/stock", label: "Stock", icon: ClipboardList },
    { href: "/customers", label: "Customers", icon: Users },
    { href: "/sales", label: "Sales History", icon: FileClock },
    { href: "/reports", label: "Reports", icon: BarChart3 },
    { href: "/expenses", label: "Expenses", icon: HandCoins },
    { href: "/audit", label: "Audit Logs", icon: Shield },
    ...(user.role === "admin"
      ? [
          { href: "/users", label: "Staff Users", icon: Users },
          { href: "/permissions", label: "Permissions", icon: Settings2 },
        ]
      : []),
  ];

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-55 border-r border-slate-800 bg-slate-950 text-slate-100 lg:block">
        <div className="flex h-16 items-center border-b border-slate-800 px-5">
          <div>
            <p className="text-lg font-semibold tracking-tight">ShopERP</p>
            <p className="text-xs text-slate-400">Super Shop Control Panel</p>
          </div>
        </div>

        <nav className="space-y-1 p-3">
          {menuItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-blue-600 text-white"
                    : "text-slate-300 hover:bg-slate-900 hover:text-white",
                )}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white shadow-[0_-4px_20px_rgba(15,23,42,0.08)] lg:hidden">
        {bottomNav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium",
                active ? "text-blue-600" : "text-slate-500",
              )}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
