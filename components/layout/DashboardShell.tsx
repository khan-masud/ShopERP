import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import type { AppUser } from "@/types/auth";

export function DashboardShell({
  user,
  children,
}: {
  user: AppUser;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-100">
      <Sidebar user={user} />
      <div className="pb-16 lg:pb-0 lg:pl-[220px]">
        <Topbar user={user} />
        <main className="mx-auto w-full max-w-[1500px] p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
