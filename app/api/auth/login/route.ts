import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  getRefreshTokenExpiryDate,
  setAuthCookies,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
} from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { sha256 } from "@/lib/server/crypto";
import { dbExecute, dbQuery, withTransaction } from "@/lib/server/db";
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

interface LoginAttemptRow extends RowDataPacket {
  attempt_count: number;
  first_attempt_at: Date;
  blocked_until: Date | null;
}

const DUMMY_PASSWORD_HASH = "$2b$10$7EqJtq98hPqEX7fNZaFWoO5M6lNQ2YsmY6hS48fM9vDOMkMt2rtIu";
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

function getLoginRateLimitError() {
  return new ApiError(429, "Too many failed login attempts. Try again in 15 minutes");
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
    const ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      null;
    const ipBucket = ipAddress ?? "";
    const userAgent = request.headers.get("user-agent") ?? null;

    const attemptRows = await dbQuery<LoginAttemptRow[]>(
      `SELECT attempt_count, first_attempt_at, blocked_until
       FROM auth_login_attempts
       WHERE email = ? AND ip_address = ?
       LIMIT 1`,
      [email, ipBucket],
    );

    const attempt = attemptRows[0];

    if (attempt?.blocked_until && new Date(attempt.blocked_until).getTime() > Date.now()) {
      throw getLoginRateLimitError();
    }

    const users = await dbQuery<UserRow[]>(
      `SELECT id, name, email, role, password_hash
       FROM users
       WHERE email = ? AND is_active = 1
       LIMIT 1`,
      [email],
    );

    const user = users[0];
    const passwordMatch = await verifyPassword(
      parsed.data.password,
      user?.password_hash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !passwordMatch) {
      const now = Date.now();
      const hasRollingWindow =
        !!attempt &&
        now - new Date(attempt.first_attempt_at).getTime() <= LOGIN_ATTEMPT_WINDOW_MS;

      const currentAttempts = hasRollingWindow ? Number(attempt?.attempt_count ?? 0) : 0;
      const nextAttemptCount = currentAttempts + 1;
      const firstAttemptAt = hasRollingWindow
        ? new Date(attempt?.first_attempt_at ?? now)
        : new Date(now);

      const blockedUntil =
        nextAttemptCount >= LOGIN_ATTEMPT_LIMIT
          ? new Date(now + LOGIN_LOCKOUT_MS)
          : null;

      await dbExecute(
        `INSERT INTO auth_login_attempts (
          email, ip_address, attempt_count, first_attempt_at, blocked_until, updated_at
        ) VALUES (?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          attempt_count = VALUES(attempt_count),
          first_attempt_at = VALUES(first_attempt_at),
          blocked_until = VALUES(blocked_until),
          updated_at = NOW()`,
        [email, ipBucket, nextAttemptCount, firstAttemptAt, blockedUntil],
      );

      if (blockedUntil) {
        throw getLoginRateLimitError();
      }

      throw new ApiError(401, "Invalid email or password");
    }

    await dbExecute(
      `DELETE FROM auth_login_attempts WHERE email = ? AND ip_address = ?`,
      [email, ipBucket],
    );

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

      const refreshTokenExpiresAt = getRefreshTokenExpiryDate();

      await conn.execute(
        `INSERT INTO user_refresh_tokens (id, user_id, session_id, token_hash, expires_at)
         VALUES (UUID(), ?, ?, ?, ?)`,
        [user.id, sessionId, sha256(refreshToken), refreshTokenExpiresAt],
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
