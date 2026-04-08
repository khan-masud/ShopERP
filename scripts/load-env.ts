import fs from "fs";
import path from "path";
import dotenv from "dotenv";

const root = process.cwd();
const envFiles = [".env", ".env.local"];

for (const file of envFiles) {
  const fullPath = path.join(root, file);

  if (fs.existsSync(fullPath)) {
    dotenv.config({
      path: fullPath,
      override: file === ".env.local",
    });
  }
}
