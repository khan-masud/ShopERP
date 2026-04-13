import mysql, {
  type Pool,
  type PoolConnection,
  type QueryResult,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { appEnv, parseDatabaseUrl } from "@/lib/server/env";
import { isDbConnectionCapacityError } from "@/lib/server/errors";

type DbParam = string | number | boolean | Date | null;
type GlobalWithDbPool = typeof globalThis & {
  __shoperpDbPool?: Pool;
};

const globalWithDbPool = globalThis as GlobalWithDbPool;

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runWithCapacityRetry<T>(operation: () => Promise<T>) {
  const attempts = appEnv.DB_RETRY_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const lastAttempt = attempt === attempts;
      if (!isDbConnectionCapacityError(error) || lastAttempt) {
        throw error;
      }

      const backoff = appEnv.DB_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      await wait(backoff);
    }
  }

  throw new Error("Unreachable retry state");
}

function createPool() {
  const dbFromUrl = parseDatabaseUrl();

  return mysql.createPool({
    host: dbFromUrl?.host ?? appEnv.DB_HOST,
    port: dbFromUrl?.port ?? appEnv.DB_PORT,
    user: dbFromUrl?.user ?? appEnv.DB_USER,
    password: dbFromUrl?.password ?? appEnv.DB_PASSWORD,
    database: dbFromUrl?.database ?? appEnv.DB_NAME,
    waitForConnections: true,
    connectionLimit: appEnv.DB_POOL_LIMIT,
    maxIdle: appEnv.DB_POOL_LIMIT,
    idleTimeout: 60_000,
    queueLimit: appEnv.DB_POOL_QUEUE_LIMIT,
    connectTimeout: appEnv.DB_CONNECT_TIMEOUT_MS,
    timezone: "Z",
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });
}

export function getPool() {
  if (!globalWithDbPool.__shoperpDbPool) {
    globalWithDbPool.__shoperpDbPool = createPool();
  }

  return globalWithDbPool.__shoperpDbPool;
}

export async function dbQuery<T extends RowDataPacket[] = RowDataPacket[]>(
  sql: string,
  params: DbParam[] = [],
  conn?: PoolConnection,
) {
  if (conn) {
    const [rows] = await conn.query<T>(sql, params);
    return rows;
  }

  const [rows] = await runWithCapacityRetry(() => getPool().query<T>(sql, params));
  return rows;
}

export async function dbExecute(
  sql: string,
  params: DbParam[] = [],
  conn?: PoolConnection,
) {
  if (conn) {
    const [result] = await conn.execute<ResultSetHeader>(sql, params);
    return result;
  }

  const [result] = await runWithCapacityRetry(() =>
    getPool().execute<ResultSetHeader>(sql, params),
  );
  return result;
}

export async function withTransaction<T>(
  callback: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await runWithCapacityRetry(() => getPool().getConnection());

  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try {
      await conn.rollback();
    } catch {
      // Ignore rollback failures and preserve the original transactional error.
    }
    throw error;
  } finally {
    conn.release();
  }
}

export type DbRow = RowDataPacket;
export type DbWriteResult = QueryResult;
