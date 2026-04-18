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
  "/analytics",
  "/expenses",
  "/audit",
  "/staff-summary",
  "/users",
  "/permissions",
];

const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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

function isMutatingRequest(request: NextRequest) {
  return mutatingMethods.has(request.method.toUpperCase());
}

function hasValidSameOrigin(request: NextRequest) {
  const requestOrigin = request.nextUrl.origin;
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (origin) {
    return origin === requestOrigin;
  }

  if (referer) {
    try {
      return new URL(referer).origin === requestOrigin;
    } catch {
      return false;
    }
  }

  return true;
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const accessToken = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  const payload = accessToken ? verifyAccessToken(accessToken) : null;

  if (isProtectedApi(pathname) && isMutatingRequest(request) && !hasValidSameOrigin(request)) {
    return NextResponse.json({ success: false, message: "Invalid request origin" }, { status: 403 });
  }

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
  matcher: ["/login", "/dashboard/:path*", "/products/:path*", "/stock/:path*", "/pos/:path*", "/customers/:path*", "/sales/:path*", "/reports/:path*", "/analytics/:path*", "/expenses/:path*", "/audit/:path*", "/staff-summary/:path*", "/users/:path*", "/permissions/:path*", "/api/:path*"],
};
