import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import type { AppUser } from "@/types/auth";
import type { UserPermissionMap } from "@/lib/server/permissions";

export function DashboardShell({
  user,
  permissionMap,
  children,
}: {
  user: AppUser;
  permissionMap: UserPermissionMap;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-100">
      <Sidebar user={user} permissionMap={permissionMap} />
      <div className="pb-16 lg:pb-0 lg:pl-55">
        <Topbar user={user} />
        <main className="mx-auto w-full max-w-375 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
