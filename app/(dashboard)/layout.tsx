import { DashboardShell } from "@/components/layout/DashboardShell";
import { getUserPermissionMap } from "@/lib/server/permissions";
import { requireUserForPage } from "@/lib/server/require-user";
import { getSiteBranding } from "@/lib/server/site-settings";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUserForPage();
  const [permissionMap, branding] = await Promise.all([
    getUserPermissionMap(user),
    getSiteBranding(),
  ]);

  return (
    <DashboardShell user={user} permissionMap={permissionMap} branding={branding}>
      {children}
    </DashboardShell>
  );
}
