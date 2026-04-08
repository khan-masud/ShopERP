import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAccessToken } from "@/lib/server/auth";
import { ACCESS_COOKIE_NAME } from "@/lib/server/constants";

export default async function Home() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE_NAME)?.value;
  const payload = accessToken ? verifyAccessToken(accessToken) : null;

  if (payload?.sub) {
    redirect("/dashboard");
  }

  redirect("/login");
}
