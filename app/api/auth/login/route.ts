import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  setAuthCookies,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
} from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { sha256 } from "@/lib/server/crypto";
import { withTransaction, dbQuery } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import { handleApiError, jsonOk } from "@/lib/server/response";

const loginSchema = z.object({
  email: z.string().email().max(191),
  password: z.string().min(8).max(100),
});

interface UserRow extends RowDataPacket {
  id: string;
  name: string;
  email: string;
  role: "admin" | "staff";
  password_hash: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => {
      throw new ApiError(400, "Invalid JSON body");
    });

    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0]?.message ?? "Invalid login payload");
    }

    const email = parsed.data.email.toLowerCase().trim();

    const users = await dbQuery<UserRow[]>(
      `SELECT id, name, email, role, password_hash
       FROM users
       WHERE email = ? AND is_active = 1
       LIMIT 1`,
      [email],
    );

    const user = users[0];
    if (!user) {
      throw new ApiError(401, "Invalid email or password");
    }

    const passwordMatch = await verifyPassword(parsed.data.password, user.password_hash);
    if (!passwordMatch) {
      throw new ApiError(401, "Invalid email or password");
    }

    const ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      null;
    const userAgent = request.headers.get("user-agent") ?? null;

    const authResult = await withTransaction(async (conn) => {
      const [historyResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO login_history (user_id, ip_address, user_agent, device_label)
         VALUES (?, ?, ?, ?)`,
        [user.id, ipAddress, userAgent, userAgent?.slice(0, 120) ?? null],
      );

      const sessionId = historyResult.insertId;

      const accessToken = signAccessToken({
        sub: user.id,
        email: user.email,
        role: user.role,
        sessionId,
      });

      const refreshToken = signRefreshToken({
        sub: user.id,
        email: user.email,
        role: user.role,
        sessionId,
      });

      await conn.execute(
        `INSERT INTO user_refresh_tokens (id, user_id, session_id, token_hash, expires_at)
         VALUES (UUID(), ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))`,
        [user.id, sessionId, sha256(refreshToken)],
      );

      await conn.execute(`UPDATE users SET last_login_at = NOW() WHERE id = ?`, [user.id]);

      await logAudit(
        {
          action: "Login",
          tableName: "users",
          recordId: user.id,
          detail: `User ${user.email} logged in`,
          userId: user.id,
          userEmail: user.email,
          ipAddress,
        },
        request,
        conn,
      );

      return { accessToken, refreshToken };
    });

    const response = jsonOk({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });

    setAuthCookies(response, authResult.accessToken, authResult.refreshToken);
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
