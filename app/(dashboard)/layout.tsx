import { DashboardShell } from "@/components/layout/DashboardShell";
import { getUserPermissionMap } from "@/lib/server/permissions";
import { requireUserForPage } from "@/lib/server/require-user";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUserForPage();
  const permissionMap = await getUserPermissionMap(user);

  return <DashboardShell user={user} permissionMap={permissionMap}>{children}</DashboardShell>;
}
