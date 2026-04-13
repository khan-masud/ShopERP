import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import {
  clearAuthCookies,
  getRefreshTokenExpiryDate,
  setAuthCookies,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { REFRESH_COOKIE_NAME } from "@/lib/server/constants";
import { sha256 } from "@/lib/server/crypto";
import { withTransaction } from "@/lib/server/db";
import { ApiError } from "@/lib/server/errors";
import { handleApiError, jsonError, jsonOk } from "@/lib/server/response";

interface RefreshTokenRow extends RowDataPacket {
  id: string;
  user_id: string;
  session_id: number | null;
  expires_at: Date;
  revoked_at: Date | null;
}

interface UserRow extends RowDataPacket {
  id: string;
  name: string;
  email: string;
  role: "admin" | "staff";
}

export async function POST(request: NextRequest) {
  try {
    const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value;

    if (!refreshToken) {
      const response = jsonError("Refresh token missing", 401);
      clearAuthCookies(response);
      return response;
    }

    const payload = verifyRefreshToken(refreshToken);

    if (!payload?.sub) {
      const response = jsonError("Invalid refresh token", 401);
      clearAuthCookies(response);
      return response;
    }

    const currentHash = sha256(refreshToken);

    const sessionResult = await withTransaction(async (conn) => {
      const [tokenRows] = await conn.query<RefreshTokenRow[]>(
        `SELECT id, user_id, session_id, expires_at, revoked_at
         FROM user_refresh_tokens
         WHERE token_hash = ?
         LIMIT 1
         FOR UPDATE`,
        [currentHash],
      );

      const tokenRow = tokenRows[0];
      if (!tokenRow || tokenRow.user_id !== payload.sub) {
        throw new ApiError(401, "Refresh token not recognized");
      }

      if (tokenRow.revoked_at) {
        throw new ApiError(401, "Refresh token revoked");
      }

      if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
        throw new ApiError(401, "Refresh token expired");
      }

      const [users] = await conn.query<UserRow[]>(
        `SELECT id, name, email, role
         FROM users
         WHERE id = ? AND is_active = 1
         LIMIT 1`,
        [tokenRow.user_id],
      );

      const user = users[0];
      if (!user) {
        throw new ApiError(401, "User not available");
      }

      await conn.execute(`UPDATE user_refresh_tokens SET revoked_at = NOW() WHERE id = ?`, [tokenRow.id]);

      const newAccessToken = signAccessToken({
        sub: user.id,
        email: user.email,
        role: user.role,
        sessionId: tokenRow.session_id ?? undefined,
      });

      const newRefreshToken = signRefreshToken({
        sub: user.id,
        email: user.email,
        role: user.role,
        sessionId: tokenRow.session_id ?? undefined,
      });

      const refreshTokenExpiresAt = getRefreshTokenExpiryDate();

      await conn.execute(
        `INSERT INTO user_refresh_tokens (id, user_id, session_id, token_hash, expires_at)
         VALUES (UUID(), ?, ?, ?, ?)`,
        [user.id, tokenRow.session_id, sha256(newRefreshToken), refreshTokenExpiresAt],
      );

      await conn.execute(
        `DELETE FROM user_refresh_tokens
         WHERE revoked_at IS NOT NULL
           AND revoked_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
         LIMIT 500`,
      );

      await logAudit(
        {
          action: "Token Refreshed",
          tableName: "user_refresh_tokens",
          recordId: tokenRow.id,
          detail: `Token refreshed for ${user.email}`,
          userId: user.id,
          userEmail: user.email,
        },
        request,
        conn,
      );

      return {
        user,
        newAccessToken,
        newRefreshToken,
      };
    });

    const response = jsonOk({
      user: {
        id: sessionResult.user.id,
        name: sessionResult.user.name,
        email: sessionResult.user.email,
        role: sessionResult.user.role,
      },
    });

    setAuthCookies(response, sessionResult.newAccessToken, sessionResult.newRefreshToken);
    return response;
  } catch (error) {
    const response = handleApiError(error);
    if (response.status === 401) {
      clearAuthCookies(response);
    }

    return response;
  }
}
