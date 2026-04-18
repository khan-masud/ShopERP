"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart,
  BarChart3,
  Boxes,
  ClipboardList,
  FileClock,
  HandCoins,
  LayoutDashboard,
  LineChart,
  ReceiptText,
  Settings2,
  Shield,
  ShoppingCart,
  Users,
  type LucideIcon,
} from "lucide-react";
import { clsx } from "clsx";
import type { AppUser } from "@/types/auth";

type PermissionFlags = {
  can_view: boolean;
  can_add: boolean;
  can_edit: boolean;
  can_delete: boolean;
};

type PermissionMap = Record<string, PermissionFlags>;

type RequiredAction = "view" | "add" | "edit" | "delete";

type MenuItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  moduleKey: string;
  requiredAction?: RequiredAction;
};

function hasPermission(permissionMap: PermissionMap, moduleKey: string, action: RequiredAction) {
  const modulePermission = permissionMap[moduleKey];

  if (!modulePermission) {
    return false;
  }

  if (action === "view") {
    return modulePermission.can_view;
  }

  if (action === "add") {
    return modulePermission.can_add;
  }

  if (action === "edit") {
    return modulePermission.can_edit;
  }

  return modulePermission.can_delete;
}

const bottomNav: MenuItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, moduleKey: "dashboard", requiredAction: "view" },
  { href: "/pos", label: "POS", icon: ShoppingCart, moduleKey: "sales", requiredAction: "add" },
  { href: "/products", label: "Products", icon: ClipboardList, moduleKey: "products", requiredAction: "view" },
  { href: "/sales", label: "Sales", icon: ReceiptText, moduleKey: "sales", requiredAction: "view" },
];

export function Sidebar({
  user,
  permissionMap,
}: {
  user: AppUser;
  permissionMap: PermissionMap;
}) {
  const pathname = usePathname();

  const mainMenuItems: MenuItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, moduleKey: "dashboard", requiredAction: "view" },
    { href: "/pos", label: "New Sale", icon: ShoppingCart, moduleKey: "sales", requiredAction: "add" },
    { href: "/products", label: "Products", icon: Boxes, moduleKey: "products", requiredAction: "view" },
    { href: "/stock", label: "Stock", icon: ClipboardList, moduleKey: "stock", requiredAction: "view" },
    { href: "/customers", label: "Customers", icon: Users, moduleKey: "customers", requiredAction: "view" },
    { href: "/sales", label: "Sales History", icon: FileClock, moduleKey: "sales", requiredAction: "view" },
    { href: "/reports", label: "Reports", icon: BarChart3, moduleKey: "reports", requiredAction: "view" },
    { href: "/analytics", label: "Analytics", icon: LineChart, moduleKey: "reports", requiredAction: "view" },
    { href: "/expenses", label: "Expenses", icon: HandCoins, moduleKey: "expenses", requiredAction: "view" },
    { href: "/audit", label: "Audit Logs", icon: Shield, moduleKey: "audit", requiredAction: "view" },
  ];

  const adminManagementItems = [
    { href: "/users", label: "Staff Users", icon: Users },
    { href: "/staff-summary", label: "Staff Summary", icon: BarChart },
    { href: "/permissions", label: "Permissions", icon: Settings2 },
  ];

  const visibleMainItems = user.role === "admin"
    ? mainMenuItems
    : mainMenuItems.filter((item) =>
      hasPermission(permissionMap, item.moduleKey, item.requiredAction ?? "view"),
    );

  const visibleBottomItems = user.role === "admin"
    ? bottomNav
    : bottomNav.filter((item) =>
      hasPermission(permissionMap, item.moduleKey, item.requiredAction ?? "view"),
    );

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
          {visibleMainItems.map((item) => {
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

          {user.role === "admin" ? (
            <div className="mt-4 border-t border-slate-800 pt-3">
              <p className="px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Staff Management
              </p>
              <div className="mt-1 space-y-1">
                {adminManagementItems.map((item) => {
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
              </div>
            </div>
          ) : null}
        </nav>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white shadow-[0_-4px_20px_rgba(15,23,42,0.08)] lg:hidden">
        {visibleBottomItems.map((item) => {
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
