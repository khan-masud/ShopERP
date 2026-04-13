import { guardModulePage } from "@/lib/server/page-guards";

export default async function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardModulePage("reports", "view");
  return children;
}
