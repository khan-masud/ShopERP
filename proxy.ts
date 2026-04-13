import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyAccessToken } from "@/lib/server/auth";
import { ACCESS_COOKIE_NAME } from "@/lib/server/constants";

const protectedPagePrefixes = [
  "/dashboard",
  "/products",
  "/stock",
  "/pos",
  "/customers",
  "/sales",
  "/reports",
  "/expenses",
  "/audit",
  "/staff-summary",
  "/users",
  "/permissions",
];

function isProtectedPage(pathname: string) {
  return protectedPagePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isProtectedApi(pathname: string) {
  if (!pathname.startsWith("/api/")) {
    return false;
  }

  return ![
    "/api/auth/login",
    "/api/auth/refresh",
  ].some((publicPath) => pathname === publicPath || pathname.startsWith(`${publicPath}/`));
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const accessToken = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  const payload = accessToken ? verifyAccessToken(accessToken) : null;

  if (pathname === "/login" && payload) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if ((isProtectedPage(pathname) || isProtectedApi(pathname)) && !payload) {
    if (isProtectedApi(pathname)) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/login", "/dashboard/:path*", "/products/:path*", "/stock/:path*", "/pos/:path*", "/customers/:path*", "/sales/:path*", "/reports/:path*", "/expenses/:path*", "/audit/:path*", "/staff-summary/:path*", "/users/:path*", "/permissions/:path*", "/api/:path*"],
};
