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

const envData = parsed.data;

const WEAK_SECRET_DEFAULTS = new Set([
  "change-this-access-secret-please",
  "change-this-refresh-secret-please",
]);

function isStrongSecret(secret: string) {
  return secret.length >= 32 && !WEAK_SECRET_DEFAULTS.has(secret);
}

export function assertStrongJwtSecrets() {
  if (envData.NODE_ENV !== "production") {
    return;
  }

  if (!isStrongSecret(envData.JWT_ACCESS_SECRET)) {
    throw new Error(
      "JWT_ACCESS_SECRET must be at least 32 characters and not use the default value in production",
    );
  }

  if (!isStrongSecret(envData.JWT_REFRESH_SECRET)) {
    throw new Error(
      "JWT_REFRESH_SECRET must be at least 32 characters and not use the default value in production",
    );
  }
}

export const appEnv = envData;

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
