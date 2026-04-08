import { DashboardShell } from "@/components/layout/DashboardShell";
import { requireUserForPage } from "@/lib/server/require-user";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUserForPage();

  return <DashboardShell user={user}>{children}</DashboardShell>;
}
