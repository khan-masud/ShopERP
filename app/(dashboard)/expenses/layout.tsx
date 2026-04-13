import { guardModulePage } from "@/lib/server/page-guards";

export default async function ExpensesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardModulePage("expenses", "view");
  return children;
}
