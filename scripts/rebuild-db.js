// Reconstrói o banco com o schema novo, levando todos os dados do antigo.
//
//   node scripts/rebuild-db.js --dry-run   → faz tudo, confere e desfaz (ROLLBACK)
//   node scripts/rebuild-db.js             → aplica de verdade
//
// Tudo numa transação só: se qualquer passo ou conferência falhar, nada muda.
// As tabelas antigas não são apagadas: vão para o schema "legacy" (volta atrás:
// npm run db:restore-legacy). Depois de conferir tudo: DROP SCHEMA legacy CASCADE;
import fs from "node:fs/promises";
import pool from "../config/db.js";

const LEGACY_TABLES = [
  "products",
  "ingredient_categories",
  "ingredients",
  "product_ingredients",
  "product_extras",
  "orders",
  "order_items",
  "order_item_customizations",
];

const dryRun = process.argv.includes("--dry-run");
const read = (file) => fs.readFile(new URL(`../db/${file}`, import.meta.url), "utf8");

export const rebuild = async (client, { log = console.log } = {}) => {
  const one = async (sql) => (await client.query(sql)).rows[0];

  if ((await one("SELECT to_regnamespace('legacy') IS NOT NULL AS exists")).exists) {
    throw new Error('Já existe um schema "legacy": o banco parece já ter sido reconstruído.');
  }
  if (!(await one("SELECT to_regclass('public.orders') IS NOT NULL AS exists")).exists) {
    throw new Error("Não encontrei a tabela orders antiga. Para um banco vazio use npm run db:setup.");
  }

  await client.query("CREATE SCHEMA legacy");
  for (const table of LEGACY_TABLES) {
    if ((await one(`SELECT to_regclass('public.${table}') IS NOT NULL AS exists`)).exists) {
      await client.query(`ALTER TABLE public.${table} SET SCHEMA legacy`);
    }
  }
  log("→ tabelas antigas movidas para o schema legacy");

  await client.query(await read("schema.sql"));
  log("→ schema novo criado");
  await client.query(await read("rebuild/from-legacy.sql"));
  log("→ dados copiados");

  // Conferências: se algo não bater, a transação inteira é desfeita.
  const checks = [
    ["produtos", "SELECT count(*) FROM legacy.products", "SELECT count(*) FROM products"],
    ["pedidos", "SELECT count(*) FROM legacy.orders", "SELECT count(*) FROM orders"],
    ["itens", "SELECT count(*) FROM legacy.order_items", "SELECT count(*) FROM order_items"],
    ["ingredientes", "SELECT count(*) FROM legacy.ingredients", "SELECT count(*) FROM ingredients"],
    ["composições", "SELECT count(*) FROM legacy.product_ingredients", "SELECT count(*) FROM product_ingredients"],
    ["faturamento", "SELECT COALESCE(sum(total_price), 0) FROM legacy.orders", "SELECT COALESCE(sum(total), 0) FROM orders"],
    ["soma dos itens", "SELECT COALESCE(sum(quantity * unit_price), 0) FROM legacy.order_items", "SELECT COALESCE(sum(quantity * unit_price), 0) FROM order_items"],
  ];
  for (const [label, before, after] of checks) {
    const a = Object.values(await one(before))[0];
    const b = Object.values(await one(after))[0];
    if (String(a) !== String(b)) throw new Error(`Conferência falhou (${label}): antes ${a}, depois ${b}`);
    log(`  ✓ ${label}: ${b}`);
  }
  const { n } = await one("SELECT count(*)::int AS n FROM customers");
  log(`  ✓ clientes cadastrados a partir dos pedidos: ${n}`);
};

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL não definido no .env");
    process.exit(1);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await rebuild(client);
    if (dryRun) {
      await client.query("ROLLBACK");
      console.log("✅ Ensaio concluído sem erros. Nada foi gravado (ROLLBACK).");
    } else {
      await client.query("COMMIT");
      console.log("✅ Banco reconstruído. As tabelas antigas estão no schema legacy.");
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Reconstrução cancelada, nada foi alterado:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
};

if (import.meta.url === `file://${process.argv[1]}`) await main();
