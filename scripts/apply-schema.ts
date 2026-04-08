import "./load-env";
import fs from "fs/promises";
import path from "path";
import mysql from "mysql2/promise";

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
      multipleStatements: true,
    };
  }

  return {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "shoperp",
    multipleStatements: true,
  };
}

async function run() {
  const sqlPath = path.join(process.cwd(), "database", "migrations", "001_init.sql");
  const sql = await fs.readFile(sqlPath, "utf8");

  const connection = await mysql.createConnection(buildDbConfig());

  try {
    await connection.query(sql);
    console.log("Schema migration applied successfully.");
  } finally {
    await connection.end();
  }
}

run().catch((error) => {
  console.error("Failed to apply schema.", error);
  process.exit(1);
});
