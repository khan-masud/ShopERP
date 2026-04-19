import { guardAdminPage } from "@/lib/server/page-guards";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardAdminPage();
  return children;
}