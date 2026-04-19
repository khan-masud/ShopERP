import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import type { AppUser } from "@/types/auth";
import type { UserPermissionMap } from "@/lib/server/permissions";
import type { SiteBranding } from "@/lib/server/site-settings";

export function DashboardShell({
  user,
  permissionMap,
  branding,
  children,
}: {
  user: AppUser;
  permissionMap: UserPermissionMap;
  branding: SiteBranding;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-100">
      <Sidebar user={user} permissionMap={permissionMap} branding={branding} />
      <div className="flex min-h-screen flex-col pb-16 lg:pb-0 lg:pl-55">
        <Topbar user={user} branding={branding} />
        <main className="mx-auto w-full max-w-375 flex-1 p-4 lg:p-6">{children}</main>
        <footer className="border-t border-slate-200 bg-white px-4 py-2 text-right text-xs text-slate-500">
          Developed by{" "}
          <a
            href="https://facebook.com/abdullahalmasud.khan.1"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-blue-600 hover:text-blue-700 hover:underline"
          >
            Abdullah Al Masud
          </a>
        </footer>
      </div>
    </div>
  );
}
