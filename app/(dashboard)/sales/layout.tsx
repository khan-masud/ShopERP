import { guardModulePage } from "@/lib/server/page-guards";

export default async function SalesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardModulePage("sales", "view");
  return children;
}
