import { guardModulePage } from "@/lib/server/page-guards";

export default async function CustomersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardModulePage("customers", "view");
  return children;
}
