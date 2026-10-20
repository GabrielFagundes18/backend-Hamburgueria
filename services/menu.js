/** Condição SQL (produto com alias `p`): todos os ingredientes do lanche estão em estoque. */
export const IN_STOCK = `NOT EXISTS (
  SELECT 1 FROM product_ingredients pi_stock
  JOIN ingredients i_stock ON i_stock.id = pi_stock.ingredient_id
  WHERE pi_stock.product_id = p.id AND NOT i_stock.in_stock
)`;

/** Pode ser vendido (inclui o "Monte seu Lanche"). */
export const ORDERABLE = `p.available AND ${IN_STOCK}`;

/** Aparece na lista do cardápio (o "Monte seu Lanche" tem página própria). */
export const ON_MENU = `${ORDERABLE} AND NOT p.is_builder`;

/** GET /products — mesmo formato de sempre: category é o nome da categoria. */
export const listMenuProducts = async (db, category) => {
  const params = [];
  let where = ON_MENU;
  if (category && category !== "todos") {
    params.push(category);
    where += " AND c.name = $1";
  }
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.description, p.price, c.name AS category, p.image_url, p.available
     FROM products p
     JOIN product_categories c ON c.id = p.category_id
     WHERE ${where}
     ORDER BY p.name ASC`,
    params,
  );
  return rows;
};

/** Produtos de um pedido que ainda podem ser vendidos. Map(String(id) → { name, price, isBuilder }). */
export const loadOrderableProducts = async (db, productIds) => {
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.price, p.is_builder
     FROM products p
     WHERE p.id::text = ANY($1::text[]) AND ${ORDERABLE}`,
    [productIds.map(String)],
  );
  return new Map(
    rows.map((row) => [String(row.id), { name: row.name, price: Number(row.price), isBuilder: row.is_builder }]),
  );
};
