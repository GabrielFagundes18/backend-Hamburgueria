import { CheckoutError } from "./errors.js";
import { ON_MENU } from "./menu.js";

const MAX_EXTRA_QUANTITY = 10;
const MAX_ITEM_NOTES = 200;

const round2 = (value) => Math.round(value * 100) / 100;

const loadBuilder = async (db) => {
  const product = (
    await db.query(
      `SELECT p.id, p.name, p.price, c.name AS category, p.description, p.image_url
       FROM products p
       JOIN product_categories c ON c.id = p.category_id
       WHERE p.is_builder AND p.available
       LIMIT 1`,
    )
  ).rows[0];
  if (!product) return null;

  const categories = (
    await db.query(
      "SELECT slug, name, builder_min, builder_max, builder_max_per_item FROM ingredient_categories ORDER BY position, name",
    )
  ).rows;
  const ingredients = (
    await db.query(
      "SELECT id, name, price, category_slug FROM ingredients WHERE in_stock AND available_in_builder ORDER BY name",
    )
  ).rows;

  const groups = categories.map((c) => ({
    slug: c.slug,
    name: c.name,
    min: c.builder_min,
    max: c.builder_max,
    maxPerItem: c.builder_max_per_item,
    ingredients: ingredients
      .filter((i) => i.category_slug === c.slug)
      .map((i) => ({ id: i.id, name: i.name, price: Number(i.price) })),
  }));

  // Categoria obrigatória sem nada em estoque (ex.: acabou o pão): "Monte seu Lanche" sai do ar.
  if (groups.some((g) => g.min > 0 && g.ingredients.length === 0)) return null;

  return {
    product: { ...product, price: Number(product.price), is_builder: true },
    groups: groups.filter((g) => g.ingredients.length > 0),
  };
};

/**
 * GET /products/customizations
 * {
 *   extras:   [{ id, name, price }]                       ← tudo que pode ser pedido a mais
 *   products: { [id]: { ingredients: [{ id, name, quantity }], extras: [ingredientId] } }
 *   builder:  { product, groups: [{ slug, name, min, max, maxPerItem, ingredients }] } | null
 * }
 */
export const getCustomizationCatalog = async (db) => {
  const extras = await db.query(
    "SELECT id, name, price FROM ingredients WHERE in_stock AND available_as_extra ORDER BY name",
  );
  const base = await db.query(
    `SELECT pi.product_id, i.id, i.name, pi.quantity, i.available_as_extra
     FROM product_ingredients pi
     JOIN ingredients i ON i.id = pi.ingredient_id
     JOIN products p ON p.id = pi.product_id
     WHERE ${ON_MENU}
     ORDER BY pi.product_id, pi.position, i.name`,
  );
  const allowed = await db.query(
    `SELECT pe.product_id, pe.ingredient_id
     FROM product_extras pe
     JOIN ingredients i ON i.id = pe.ingredient_id
     JOIN products p ON p.id = pe.product_id
     WHERE i.in_stock AND i.available_as_extra AND ${ON_MENU}
     ORDER BY i.name`,
  );

  const products = {};
  const entry = (productId) => (products[productId] ??= { ingredients: [], extras: [] });
  base.rows.forEach((row) => {
    const e = entry(row.product_id);
    e.ingredients.push({ id: row.id, name: row.name, quantity: Number(row.quantity) });
    // O que já vem no lanche pode ser pedido a mais (mais carne, mais queijo...).
    if (row.available_as_extra) e.extras.push(row.id);
  });
  allowed.rows.forEach((row) => {
    const e = entry(row.product_id);
    if (!e.extras.includes(row.ingredient_id)) e.extras.push(row.ingredient_id);
  });

  return {
    extras: extras.rows.map((row) => ({ id: row.id, name: row.name, price: Number(row.price) })),
    products,
    builder: await loadBuilder(db),
  };
};

const toIdList = (value) => (Array.isArray(value) ? value : []);

const groupBy = (rows) => {
  const map = new Map();
  rows.forEach((row) => {
    const key = String(row.product_id);
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(row.ingredient_id);
  });
  return map;
};

/** Lanche do cardápio: remover o que vem nele (preço igual) e pedir a mais o que for permitido. */
const priceRegularItem = (item, key, product, data) => {
  const base = data.baseByProduct.get(key) ?? new Set();
  const allowed = data.allowedByProduct.get(key) ?? new Set();
  const customizations = [];
  let unitPrice = product.price;

  const removedIds = new Set(toIdList(item.removed_ingredients).map(Number));
  for (const id of removedIds) {
    const ingredient = data.ingredientById.get(id);
    if (!base.has(id) || !ingredient?.in_stock) throw new CheckoutError(`Ingrediente inválido para ${product.name}.`);
    customizations.push({ ingredientId: id, name: ingredient.name, type: "removed", quantity: 1, chargedPrice: 0 });
  }

  const seen = new Set();
  for (const extra of toIdList(item.extras)) {
    const id = Number(extra?.ingredient_id);
    const quantity = Number(extra?.quantity);
    const ingredient = data.ingredientById.get(id);
    if (seen.has(id)) throw new CheckoutError("Adicional repetido no mesmo item.");
    seen.add(id);
    if (removedIds.has(id)) {
      throw new CheckoutError(`Não dá para remover e pedir ${ingredient?.name ?? "o mesmo ingrediente"} a mais no mesmo lanche.`);
    }
    if (!(allowed.has(id) || base.has(id)) || !ingredient?.in_stock || !ingredient.available_as_extra) {
      throw new CheckoutError(`Adicional indisponível para ${product.name}.`);
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_EXTRA_QUANTITY) {
      throw new CheckoutError("Quantidade de adicional inválida.");
    }
    customizations.push({ ingredientId: id, name: ingredient.name, type: "added", quantity, chargedPrice: ingredient.price });
    unitPrice += ingredient.price * quantity;
  }
  return { unitPrice, customizations };
};

/** "Monte seu Lanche": preço base + cada ingrediente escolhido, respeitando as regras da categoria. */
const priceBuilderItem = (item, product, data) => {
  if (toIdList(item.removed_ingredients).length > 0) throw new CheckoutError("Personalização inválida no carrinho.");
  const chosen = toIdList(item.extras);
  if (chosen.length === 0) throw new CheckoutError("Escolha os ingredientes do seu lanche.");

  const customizations = [];
  const totals = new Map();
  const seen = new Set();
  let unitPrice = product.price;

  for (const extra of chosen) {
    const id = Number(extra?.ingredient_id);
    const quantity = Number(extra?.quantity);
    const ingredient = data.ingredientById.get(id);
    if (seen.has(id)) throw new CheckoutError("Ingrediente repetido no lanche montado.");
    seen.add(id);
    if (!ingredient?.in_stock || !ingredient.available_in_builder) {
      throw new CheckoutError("Um dos ingredientes escolhidos não está disponível. Monte o lanche de novo.");
    }
    const category = data.categories.get(ingredient.category_slug);
    if (!category || !Number.isInteger(quantity) || quantity < 1 || quantity > category.maxPerItem) {
      throw new CheckoutError(`Quantidade inválida de ${ingredient.name}.`);
    }
    totals.set(ingredient.category_slug, (totals.get(ingredient.category_slug) ?? 0) + quantity);
    customizations.push({ ingredientId: id, name: ingredient.name, type: "added", quantity, chargedPrice: ingredient.price });
    unitPrice += ingredient.price * quantity;
  }

  for (const [slug, category] of data.categories) {
    const total = totals.get(slug) ?? 0;
    if (total < category.min) throw new CheckoutError(`Escolha ${category.name.toLowerCase()} para o seu lanche.`);
    if (total > category.max) throw new CheckoutError(`Máximo de ${category.max} em ${category.name}.`);
  }
  return { unitPrice, customizations };
};

/**
 * Valida as personalizações de cada item e calcula o preço unitário final com os
 * preços do banco. `productsById`: resultado de loadOrderableProducts().
 */
export const priceCartItems = async (db, items, productsById) => {
  for (const item of items) {
    if (item.removed_ingredients !== undefined && !Array.isArray(item.removed_ingredients)) {
      throw new CheckoutError("Personalização inválida no carrinho.");
    }
    if (item.extras !== undefined && !Array.isArray(item.extras)) {
      throw new CheckoutError("Personalização inválida no carrinho.");
    }
  }

  const keyOf = (item) => String(item.product_id || item.id);
  const involved = items.filter(
    (item) =>
      toIdList(item.removed_ingredients).length > 0 ||
      toIdList(item.extras).length > 0 ||
      productsById.get(keyOf(item))?.isBuilder,
  );

  const data = {
    baseByProduct: new Map(),
    allowedByProduct: new Map(),
    ingredientById: new Map(),
    categories: new Map(),
  };

  if (involved.length > 0) {
    const productIds = [...new Set(involved.map(keyOf))];
    const ingredientIds = [
      ...new Set(
        involved
          .flatMap((item) => [...toIdList(item.removed_ingredients), ...toIdList(item.extras).map((e) => e?.ingredient_id)])
          .map(Number),
      ),
    ];
    if (ingredientIds.some((id) => !Number.isInteger(id))) {
      throw new CheckoutError("Personalização inválida no carrinho.");
    }

    data.baseByProduct = groupBy(
      (await db.query(
        "SELECT product_id, ingredient_id FROM product_ingredients WHERE product_id::text = ANY($1::text[])",
        [productIds],
      )).rows,
    );
    data.allowedByProduct = groupBy(
      (await db.query(
        "SELECT product_id, ingredient_id FROM product_extras WHERE product_id::text = ANY($1::text[])",
        [productIds],
      )).rows,
    );
    (await db.query(
      `SELECT id, name, price, available_as_extra, in_stock, category_slug, available_in_builder
       FROM ingredients WHERE id = ANY($1::int[])`,
      [ingredientIds],
    )).rows.forEach((row) => data.ingredientById.set(row.id, { ...row, price: Number(row.price) }));

    if (involved.some((item) => productsById.get(keyOf(item))?.isBuilder)) {
      (await db.query(
        "SELECT slug, name, builder_min, builder_max, builder_max_per_item FROM ingredient_categories",
      )).rows.forEach((c) =>
        data.categories.set(c.slug, { name: c.name, min: c.builder_min, max: c.builder_max, maxPerItem: c.builder_max_per_item }),
      );
    }
  }

  return items.map((item) => {
    const productId = item.product_id || item.id;
    const key = String(productId);
    const product = productsById.get(key);
    if (!product) {
      throw new CheckoutError("Um dos produtos do carrinho não está mais disponível. Atualize o cardápio.");
    }
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new CheckoutError("Quantidade inválida no carrinho.");
    }
    const notes = typeof item.notes === "string" ? item.notes.trim().slice(0, MAX_ITEM_NOTES) : "";

    const { unitPrice, customizations } = product.isBuilder
      ? priceBuilderItem(item, product, data)
      : priceRegularItem(item, key, product, data);

    return {
      productId,
      name: product.name,
      isBuilder: product.isBuilder,
      quantity,
      unitPrice: round2(unitPrice),
      notes,
      customizations,
    };
  });
};
