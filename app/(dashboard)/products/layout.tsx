import { guardModulePage } from "@/lib/server/page-guards";

export default async function ProductsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardModulePage("products", "view");
  return children;
}
