import { guardModulePage } from "@/lib/server/page-guards";

export default async function UsersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardModulePage("users", "view");
  return children;
}
