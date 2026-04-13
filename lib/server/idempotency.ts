import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { sha256 } from "@/lib/server/crypto";
import { ApiError } from "@/lib/server/errors";

const IDEMPOTENCY_MIN_LENGTH = 8;
const IDEMPOTENCY_MAX_LENGTH = 120;
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

interface IdempotencyRow extends RowDataPacket {
  request_hash: string;
  status: "pending" | "completed";
  response_json: string | null;
  expires_at: Date;
}

type BeginArgs = {
  userId: string;
  scope: string;
  key: string;
  requestHash: string;
  ttlSeconds?: number;
};

type CompleteArgs = {
  userId: string;
  scope: string;
  key: string;
  requestHash: string;
  response: unknown;
  ttlSeconds?: number;
};

type IdempotencyReplay<T> =
  | {
      replayed: true;
      response: T;
    }
  | {
      replayed: false;
    };

function isDuplicateEntryError(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ER_DUP_ENTRY"
  );
}

function calculateExpiry(ttlSeconds?: number) {
  const ttl = Number.isFinite(ttlSeconds) && (ttlSeconds ?? 0) > 0
    ? Math.floor(ttlSeconds as number)
    : DEFAULT_TTL_SECONDS;

  return new Date(Date.now() + ttl * 1000);
}

export function readIdempotencyKey(request: NextRequest) {
  const rawHeader =
    request.headers.get("idempotency-key") ?? request.headers.get("x-idempotency-key");

  if (!rawHeader) {
    return null;
  }

  const key = rawHeader.trim();

  if (!key) {
    return null;
  }

  if (key.length < IDEMPOTENCY_MIN_LENGTH || key.length > IDEMPOTENCY_MAX_LENGTH) {
    throw new ApiError(
      422,
      `Idempotency key must be between ${IDEMPOTENCY_MIN_LENGTH} and ${IDEMPOTENCY_MAX_LENGTH} characters`,
    );
  }

  return key;
}

export function buildIdempotencyHash(payload: unknown) {
  return sha256(JSON.stringify(payload));
}

async function reserveIdempotencyKey(conn: PoolConnection, args: BeginArgs) {
  await conn.execute(
    `INSERT INTO idempotency_keys (
      id, user_id, scope, idempotency_key, request_hash,
      status, response_json, expires_at, created_at, updated_at
    ) VALUES (UUID(), ?, ?, ?, ?, 'pending', NULL, ?, NOW(), NOW())`,
    [
      args.userId,
      args.scope,
      args.key,
      args.requestHash,
      calculateExpiry(args.ttlSeconds),
    ],
  );
}

async function readExistingIdempotency<T>(conn: PoolConnection, args: BeginArgs) {
  const [rows] = await conn.query<IdempotencyRow[]>(
    `SELECT request_hash, status, response_json, expires_at
     FROM idempotency_keys
     WHERE user_id = ? AND scope = ? AND idempotency_key = ?
     LIMIT 1
     FOR UPDATE`,
    [args.userId, args.scope, args.key],
  );

  const row = rows[0];

  if (!row) {
    return null;
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await conn.execute(
      `DELETE FROM idempotency_keys
       WHERE user_id = ? AND scope = ? AND idempotency_key = ?`,
      [args.userId, args.scope, args.key],
    );

    return null;
  }

  if (row.request_hash !== args.requestHash) {
    throw new ApiError(409, "Idempotency key was already used with a different payload");
  }

  if (row.status === "completed" && row.response_json) {
    return {
      replayed: true,
      response: JSON.parse(row.response_json) as T,
    } satisfies IdempotencyReplay<T>;
  }

  throw new ApiError(409, "Request with this idempotency key is already being processed");
}

export async function beginIdempotentRequest<T>(
  conn: PoolConnection,
  args: BeginArgs,
): Promise<IdempotencyReplay<T>> {
  try {
    await reserveIdempotencyKey(conn, args);
    return { replayed: false };
  } catch (error) {
    if (!isDuplicateEntryError(error)) {
      throw error;
    }
  }

  const existing = await readExistingIdempotency<T>(conn, args);

  if (existing) {
    return existing;
  }

  await reserveIdempotencyKey(conn, args);
  return { replayed: false };
}

export async function completeIdempotentRequest(conn: PoolConnection, args: CompleteArgs) {
  const responseText = JSON.stringify(args.response);
  const [result] = await conn.execute<ResultSetHeader>(
    `UPDATE idempotency_keys
     SET status = 'completed', response_json = ?, expires_at = ?, updated_at = NOW()
     WHERE user_id = ? AND scope = ? AND idempotency_key = ? AND request_hash = ?`,
    [
      responseText,
      calculateExpiry(args.ttlSeconds),
      args.userId,
      args.scope,
      args.key,
      args.requestHash,
    ],
  );

  if (result.affectedRows !== 1) {
    throw new ApiError(409, "Failed to finalize idempotent request");
  }
}
