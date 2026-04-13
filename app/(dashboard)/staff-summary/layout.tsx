import { guardAdminPage } from "@/lib/server/page-guards";

export default async function StaffSummaryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardAdminPage();
  return children;
}
