-- Copia os dados do banco antigo (schema "legacy") para o schema novo, normalizando no caminho.
-- Roda dentro da transação do scripts/rebuild-db.js, depois de db/schema.sql.

-- ---------- Cardápio ----------

INSERT INTO product_categories (name, position) VALUES
  ('Hambúrgueres', 1), ('Acompanhamentos', 2), ('Bebidas', 3), ('Combo', 4), ('Sobremesas', 5);

INSERT INTO product_categories (name, position)
SELECT DISTINCT p.category, 99
FROM legacy.products p
WHERE p.category NOT IN (SELECT name FROM product_categories);

INSERT INTO products (id, category_id, name, description, price, image_url, available, is_builder)
SELECT p.id, c.id, trim(p.name), NULLIF(trim(p.description), ''), p.price,
       NULLIF(trim(p.image_url), ''), COALESCE(p.available, TRUE), COALESCE(p.is_builder, FALSE)
FROM legacy.products p
JOIN product_categories c ON c.name = p.category;

INSERT INTO ingredient_categories (slug, name, position, builder_min, builder_max, builder_max_per_item)
SELECT slug, name, position, builder_min, builder_max, builder_max_per_item
FROM legacy.ingredient_categories;

INSERT INTO ingredients (id, category_slug, name, price, in_stock, available_as_extra, available_in_builder)
SELECT id, category, name, extra_price, active, available_as_extra, available_in_builder
FROM legacy.ingredients;

INSERT INTO product_ingredients (product_id, ingredient_id, quantity, position)
SELECT product_id, ingredient_id, quantity, position FROM legacy.product_ingredients;

INSERT INTO product_extras (product_id, ingredient_id)
SELECT product_id, ingredient_id FROM legacy.product_extras;

-- ---------- Cupons (antes ficavam no código) ----------

INSERT INTO coupons (code, description, discount_percent, first_order_only)
VALUES ('NINJA20', '20% OFF no primeiro pedido', 20, TRUE);

-- ---------- Clientes: um por telefone (DDD + número), com o nome mais recente ----------

INSERT INTO customers (name, phone, created_at)
SELECT DISTINCT ON (phone) name, phone, first_at
FROM (
  SELECT COALESCE(NULLIF(trim(customer_name), ''), 'Cliente') AS name,
         right(regexp_replace(customer_whatsapp, '[^0-9]', '', 'g'), 11) AS phone,
         (min(created_at) OVER (PARTITION BY right(regexp_replace(customer_whatsapp, '[^0-9]', '', 'g'), 11)))
           AT TIME ZONE 'UTC' AS first_at,
         created_at
  FROM legacy.orders
  WHERE length(regexp_replace(COALESCE(customer_whatsapp, ''), '[^0-9]', '', 'g')) >= 10
) t
ORDER BY phone, created_at DESC;

-- ---------- Pedidos ----------
-- created_at antigo era "timestamp sem fuso" gravado em UTC.

INSERT INTO orders (
  id, customer_id, customer_name, customer_phone, channel, status, payment_method, change_for,
  cep, address_street, address_number, address_complement, address_neighborhood, notes,
  subtotal, discount, total, coupon_code, created_at, updated_at
)
SELECT
  o.id,
  c.id,
  COALESCE(NULLIF(trim(o.customer_name), ''), 'Cliente'),
  NULLIF(NULLIF(trim(o.customer_whatsapp), ''), 'N/A'),
  COALESCE(o.type, 'balcao'),
  COALESCE(o.status, 'pendente'),
  CASE
    WHEN o.payment_method ILIKE 'pix' THEN 'Pix'
    WHEN o.payment_method ILIKE 'cart%' THEN 'Cartão'
    WHEN o.payment_method ILIKE 'dinheiro' THEN 'Dinheiro'
  END,
  NULLIF(NULLIF(trim(o.change_details), ''), 'N/A'),
  NULLIF(trim(o.cep), ''),
  NULLIF(NULLIF(trim(o.address_street), ''), 'Retirada Local'),
  NULLIF(NULLIF(trim(o.address_number), ''), 'N/A'),
  NULLIF(trim(o.address_complement), ''),
  NULLIF(trim(o.address_neighborhood), ''),
  NULLIF(NULLIF(trim(o.notes), ''), 'Sem observações'),
  o.total_price,
  0,
  o.total_price,
  NULL,
  o.created_at AT TIME ZONE 'UTC',
  o.created_at AT TIME ZONE 'UTC'
FROM legacy.orders o
LEFT JOIN customers c
  ON length(regexp_replace(COALESCE(o.customer_whatsapp, ''), '[^0-9]', '', 'g')) >= 10
 AND c.phone = right(regexp_replace(o.customer_whatsapp, '[^0-9]', '', 'g'), 11);

INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, notes)
SELECT oi.id, oi.order_id, oi.product_id, COALESCE(p.name, 'Produto removido'),
       oi.quantity, oi.unit_price, NULLIF(trim(oi.notes), '')
FROM legacy.order_items oi
LEFT JOIN legacy.products p ON p.id = oi.product_id;

INSERT INTO order_item_customizations (id, order_item_id, ingredient_id, ingredient_name, kind, quantity, unit_price)
SELECT id, order_item_id, ingredient_id, ingredient_name, type, quantity, charged_price
FROM legacy.order_item_customizations;

-- ---------- Sequências continuam de onde os ids pararam ----------

SELECT setval(pg_get_serial_sequence('product_categories', 'id'), (SELECT COALESCE(max(id), 0) + 1 FROM product_categories), false);
SELECT setval(pg_get_serial_sequence('products', 'id'), (SELECT COALESCE(max(id), 0) + 1 FROM products), false);
SELECT setval(pg_get_serial_sequence('ingredients', 'id'), (SELECT COALESCE(max(id), 0) + 1 FROM ingredients), false);
SELECT setval(pg_get_serial_sequence('customers', 'id'), (SELECT COALESCE(max(id), 0) + 1 FROM customers), false);
SELECT setval(pg_get_serial_sequence('orders', 'id'), (SELECT COALESCE(max(id), 0) + 1 FROM orders), false);
SELECT setval(pg_get_serial_sequence('order_items', 'id'), (SELECT COALESCE(max(id), 0) + 1 FROM order_items), false);
SELECT setval(pg_get_serial_sequence('order_item_customizations', 'id'), (SELECT COALESCE(max(id), 0) + 1 FROM order_item_customizations), false);
