import "./load-env";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2/promise";

interface ExistingUserRow extends RowDataPacket {
  id: string;
  email: string;
}

function buildDbConfig() {
  const dbUrl = process.env.DATABASE_URL;

  if (dbUrl) {
    const parsed = new URL(dbUrl);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 3306),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ""),
    };
  }

  return {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "shoperp",
  };
}

async function run() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@shoperp.local";
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME ?? "ShopERP Owner";

  if (!password || password.length < 8) {
    throw new Error("SEED_ADMIN_PASSWORD is required and must be at least 8 characters.");
  }

  const connection = await mysql.createConnection(buildDbConfig());

  try {
    const [existingRows] = await connection.query<ExistingUserRow[]>(
      "SELECT id, email FROM users WHERE email = ? LIMIT 1",
      [email],
    );

    const passwordHash = await bcrypt.hash(password, 12);

    if (existingRows[0]) {
      await connection.execute(
        `UPDATE users
         SET name = ?, password_hash = ?, role = 'admin', is_active = 1, updated_at = NOW()
         WHERE id = ?`,
        [name, passwordHash, existingRows[0].id],
      );

      console.log(`Updated existing admin: ${email}`);
      return;
    }

    await connection.execute(
      `INSERT INTO users (
        id, name, email, password_hash, role, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'admin', 1, NOW(), NOW())`,
      [randomUUID(), name, email, passwordHash],
    );

    console.log(`Created admin user: ${email}`);
  } finally {
    await connection.end();
  }
}

run().catch((error) => {
  console.error("Failed to seed admin user.", error);
  process.exit(1);
});
