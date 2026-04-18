import { guardModulePage } from "@/lib/server/page-guards";

export default async function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardModulePage("reports", "view");
  return children;
}
