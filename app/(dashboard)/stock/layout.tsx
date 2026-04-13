import { guardModulePage } from "@/lib/server/page-guards";

export default async function StockLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardModulePage("stock", "view");
  return children;
}
