import type { PoolConnection } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { dbExecute } from "@/lib/server/db";

type AuditPayload = {
  action: string;
  detail: string;
  tableName?: string | null;
  recordId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  ipAddress?: string | null;
};

function extractIp(request?: NextRequest) {
  if (!request) {
    return null;
  }

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? null;
  }

  return request.headers.get("x-real-ip");
}

export async function logAudit(
  payload: AuditPayload,
  request?: NextRequest,
  conn?: PoolConnection,
) {
  const detail = payload.detail.slice(0, 5000);
  const ipAddress = payload.ipAddress ?? extractIp(request);

  await dbExecute(
    `INSERT INTO audit_logs (
      id, action, table_name, record_id, detail,
      user_id, user_email, ip_address, created_at
    ) VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      payload.action,
      payload.tableName ?? null,
      payload.recordId ?? null,
      detail,
      payload.userId ?? null,
      payload.userEmail ?? null,
      ipAddress,
    ],
    conn,
  );
}
