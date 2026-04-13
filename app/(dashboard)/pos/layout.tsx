import { guardModulePage } from "@/lib/server/page-guards";

export default async function POSLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardModulePage("sales", "add");
  return children;
}
