import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().optional(),
  NEXT_PUBLIC_BASE_URL: z.string().url().optional(),
  DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().default(3306),
  DB_USER: z.string().default("root"),
  DB_PASSWORD: z.string().default(""),
  DB_NAME: z.string().default("shoperp"),
  JWT_ACCESS_SECRET: z.string().default("change-this-access-secret-please"),
  JWT_REFRESH_SECRET: z.string().default("change-this-refresh-secret-please"),
  ACCESS_TOKEN_TTL: z.string().default("30m"),
  REFRESH_TOKEN_TTL: z.string().default("7d"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment config: ${parsed.error.message}`);
}

export const appEnv = parsed.data;

export const isProduction = appEnv.NODE_ENV === "production";

export function parseDatabaseUrl() {
  if (!appEnv.DATABASE_URL) {
    return null;
  }

  const url = new URL(appEnv.DATABASE_URL);

  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
  };
}
