import type { RowDataPacket } from "mysql2/promise";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE_NAME, type UserRole } from "@/lib/server/constants";
import { verifyAccessToken } from "@/lib/server/auth";
import { dbQuery } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

interface UserRow extends RowDataPacket {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

async function getActiveUserById(userId: string): Promise<SessionUser | null> {
  const rows = await dbQuery<UserRow[]>(
    `SELECT id, name, email, role
     FROM users
     WHERE id = ? AND is_active = 1
     LIMIT 1`,
    [userId],
  );

  if (!rows[0]) {
    return null;
  }

  return {
    id: rows[0].id,
    name: rows[0].name,
    email: rows[0].email,
    role: rows[0].role,
  };
}

export async function getUserFromRequest(request: NextRequest) {
  const token = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  const payload = verifyAccessToken(token);
  if (!payload?.sub) {
    return null;
  }

  return getActiveUserById(payload.sub);
}

export async function requireUserFromRequest(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) {
    throw new ApiError(401, "Unauthorized");
  }

  return user;
}

export async function requireUserForPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_COOKIE_NAME)?.value;

  if (!token) {
    redirect("/login");
  }

  const payload = verifyAccessToken(token);
  if (!payload?.sub) {
    redirect("/login");
  }

  const user = await getActiveUserById(payload.sub);
  if (!user) {
    redirect("/login");
  }

  return user;
}
