import { guardModulePage } from "@/lib/server/page-guards";

export default async function AuditLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardModulePage("audit", "view");
  return children;
}
