import mysql, {
  type Pool,
  type PoolConnection,
  type QueryResult,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { appEnv, parseDatabaseUrl } from "@/lib/server/env";

type DbParam = string | number | boolean | Date | null;

let pool: Pool | null = null;

function createPool() {
  const dbFromUrl = parseDatabaseUrl();

  return mysql.createPool({
    host: dbFromUrl?.host ?? appEnv.DB_HOST,
    port: dbFromUrl?.port ?? appEnv.DB_PORT,
    user: dbFromUrl?.user ?? appEnv.DB_USER,
    password: dbFromUrl?.password ?? appEnv.DB_PASSWORD,
    database: dbFromUrl?.database ?? appEnv.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: "Z",
  });
}

export function getPool() {
  if (!pool) {
    pool = createPool();
  }

  return pool;
}

export async function dbQuery<T extends RowDataPacket[] = RowDataPacket[]>(
  sql: string,
  params: DbParam[] = [],
  conn?: PoolConnection,
) {
  const executor = conn ?? getPool();
  const [rows] = await executor.query<T>(sql, params);
  return rows;
}

export async function dbExecute(
  sql: string,
  params: DbParam[] = [],
  conn?: PoolConnection,
) {
  const executor = conn ?? getPool();
  const [result] = await executor.execute<ResultSetHeader>(sql, params);
  return result;
}

export async function withTransaction<T>(
  callback: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await getPool().getConnection();

  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export type DbRow = RowDataPacket;
export type DbWriteResult = QueryResult;
