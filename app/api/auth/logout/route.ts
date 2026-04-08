import type { NextRequest } from "next/server";
import {
  clearAuthCookies,
  verifyAccessToken,
} from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from "@/lib/server/constants";
import { sha256 } from "@/lib/server/crypto";
import { withTransaction } from "@/lib/server/db";
import { handleApiError, jsonOk } from "@/lib/server/response";

export async function POST(request: NextRequest) {
  try {
    const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value;
    const accessPayload = verifyAccessToken(request.cookies.get(ACCESS_COOKIE_NAME)?.value ?? "");

    await withTransaction(async (conn) => {
      if (refreshToken) {
        await conn.execute(
          `UPDATE user_refresh_tokens
           SET revoked_at = NOW()
           WHERE token_hash = ? AND revoked_at IS NULL`,
          [sha256(refreshToken)],
        );
      }

      if (accessPayload?.sessionId && accessPayload.sub) {
        await conn.execute(
          `UPDATE login_history
           SET logged_out_at = NOW()
           WHERE id = ? AND user_id = ? AND logged_out_at IS NULL`,
          [accessPayload.sessionId, accessPayload.sub],
        );

        await logAudit(
          {
            action: "Logout",
            tableName: "login_history",
            recordId: String(accessPayload.sessionId),
            detail: `User ${accessPayload.email} logged out`,
            userId: accessPayload.sub,
            userEmail: accessPayload.email,
          },
          request,
          conn,
        );
      }
    });

    const response = jsonOk({ message: "Logged out" });
    clearAuthCookies(response);
    return response;
  } catch (error) {
    const response = handleApiError(error);
    clearAuthCookies(response);
    return response;
  }
}
