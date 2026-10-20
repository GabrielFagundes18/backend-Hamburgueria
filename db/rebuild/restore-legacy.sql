-- Volta atrás da reconstrução: apaga o schema novo e devolve as tabelas antigas (schema "legacy").
-- Uso: npm run db:restore-legacy  (só funciona enquanto o schema "legacy" existir)
-- O run-sql.js já executa tudo numa transação.

DROP TABLE IF EXISTS
  order_item_customizations, order_items, orders, coupons, customers,
  product_extras, product_ingredients, ingredients, ingredient_categories,
  products, product_categories
CASCADE;
DROP FUNCTION IF EXISTS set_updated_at();

ALTER TABLE legacy.products SET SCHEMA public;
ALTER TABLE legacy.ingredient_categories SET SCHEMA public;
ALTER TABLE legacy.ingredients SET SCHEMA public;
ALTER TABLE legacy.product_ingredients SET SCHEMA public;
ALTER TABLE legacy.product_extras SET SCHEMA public;
ALTER TABLE legacy.orders SET SCHEMA public;
ALTER TABLE legacy.order_items SET SCHEMA public;
ALTER TABLE legacy.order_item_customizations SET SCHEMA public;

DROP SCHEMA legacy;
