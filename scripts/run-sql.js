// Aplica arquivos .sql no banco do DATABASE_URL, todos numa transação só
// (se um falhar, nada é gravado).
//   node scripts/run-sql.js db/schema.sql db/seed.sql
import fs from "node:fs/promises";
import pool from "../config/db.js";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Uso: node scripts/run-sql.js <arquivo.sql> [outro.sql ...]");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL não definido. Crie um .env na raiz do backend com DATABASE_URL=<connection string do Neon>.");
  await pool.end();
  process.exit(1);
}

const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const file of files) {
    await client.query(await fs.readFile(file, "utf8"));
    console.log(`✅ ${file}`);
  }
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("❌ Erro, nada foi gravado:", err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
