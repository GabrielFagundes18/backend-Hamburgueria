import { priceCartItems } from "./customization.js";
import { CheckoutError } from "./errors.js";
import { loadOrderableProducts } from "./menu.js";

export { CheckoutError };

const round2 = (value) => Math.round(value * 100) / 100;

const PAYMENT_METHODS = ["Pix", "Cartão", "Dinheiro"];

/** Texto padrão que o site manda quando o cliente não escreve nada. */
const NO_NOTES = "Sem observações";

/** Texto opcional: espaços cortados; vazio vira null. */
const clean = (value) => {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text === "" ? null : text;
};

/** DDD + número, só dígitos: "+55 (11) 98888-7777" → "11988887777". Vazio se não for um telefone. */
export const normalizePhone = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "").slice(-11);
  return digits.length >= 10 ? digits : "";
};

const isFirstOrder = async (db, phone) => {
  // Pedidos cancelados no painel não contam como "primeiro pedido".
  const { rowCount } = await db.query(
    `SELECT 1 FROM orders o
     JOIN customers c ON c.id = o.customer_id
     WHERE c.phone = $1 AND o.status <> 'cancelado'
     LIMIT 1`,
    [phone],
  );
  return rowCount === 0;
};

/** Valida o cupom (tabela coupons) para este cliente. Lança CheckoutError se não puder ser usado. */
export const resolveCoupon = async (db, code, whatsapp) => {
  const key = String(code ?? "").trim().toUpperCase();
  const coupon = key
    ? (
        await db.query(
          `SELECT code, description, discount_percent, first_order_only
           FROM coupons
           WHERE code = $1 AND active AND (valid_until IS NULL OR valid_until > now())`,
          [key],
        )
      ).rows[0]
    : null;
  if (!coupon) throw new CheckoutError("Cupom inválido ou expirado.");

  if (coupon.first_order_only) {
    const phone = normalizePhone(whatsapp);
    if (!phone) throw new CheckoutError("Informe seu WhatsApp para usar este cupom.");
    if (!(await isFirstOrder(db, phone))) {
      throw new CheckoutError("Este cupom é válido apenas no primeiro pedido.");
    }
  }
  return { code: coupon.code, percent: Number(coupon.discount_percent), description: coupon.description };
};

/** Cria ou atualiza o cliente pelo telefone. Sem telefone válido, o pedido fica sem cliente vinculado. */
const upsertCustomer = async (db, name, phone) => {
  if (!phone) return null;
  const { rows } = await db.query(
    `INSERT INTO customers (name, phone) VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name, phone],
  );
  return rows[0].id;
};

/**
 * POST /orders/checkout
 * Preços e total são recalculados com os valores do banco (lanche + adicionais) —
 * o que vem do navegador (price/total_price) não é usado para gravar o pedido.
 */
export const createCheckoutHandler = (pool) => async (req, res) => {
  console.log("Dados recebidos no body:", req.body);

  const {
    customer_name,
    customer_whatsapp,
    cep,
    address_street,
    address_number,
    address_complement,
    address_neighborhood,
    payment_method,
    change_details,
    notes,
    items,
    coupon_code,
  } = req.body;

  const name = clean(customer_name);
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Seu carrinho está vazio." });
  }
  if (!name) return res.status(400).json({ error: "Informe seu nome." });
  if (!PAYMENT_METHODS.includes(payment_method)) {
    return res.status(400).json({ error: "Forma de pagamento inválida." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const productIds = items.map((item) => item.product_id || item.id);
    if (productIds.some((id) => !id)) {
      throw new CheckoutError("ID do produto não encontrado no item do carrinho");
    }
    // Só entram produtos disponíveis e com todos os ingredientes em estoque.
    const productsById = await loadOrderableProducts(client, productIds);
    // Valida remoções/adicionais e calcula o preço unitário final de cada item.
    const lines = await priceCartItems(client, items, productsById);

    const subtotal = round2(lines.reduce((acc, line) => acc + line.unitPrice * line.quantity, 0));
    let discount = 0;
    let appliedCoupon = null;
    if (coupon_code) {
      const coupon = await resolveCoupon(client, coupon_code, customer_whatsapp);
      discount = round2((subtotal * coupon.percent) / 100);
      appliedCoupon = coupon.code;
    }
    const total = round2(subtotal - discount);

    const customerId = await upsertCustomer(client, name, normalizePhone(customer_whatsapp));
    const customerNotes = clean(notes);

    const orderRes = await client.query(
      `INSERT INTO orders (
         customer_id, customer_name, customer_phone, channel, payment_method, change_for,
         cep, address_street, address_number, address_complement, address_neighborhood,
         notes, subtotal, discount, total, coupon_code
       ) VALUES ($1, $2, $3, 'website', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [
        customerId,
        name,
        clean(customer_whatsapp),
        payment_method,
        clean(change_details),
        clean(cep),
        clean(address_street),
        clean(address_number),
        clean(address_complement),
        clean(address_neighborhood),
        customerNotes === NO_NOTES ? null : customerNotes,
        subtotal,
        discount,
        total,
        appliedCoupon,
      ],
    );
    const orderId = orderRes.rows[0].id;

    for (const line of lines) {
      // Nome e preço congelados: renomear/apagar o produto depois não altera o pedido.
      const itemRes = await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [orderId, line.productId, line.name, line.quantity, line.unitPrice, line.notes || null],
      );
      for (const c of line.customizations) {
        await client.query(
          `INSERT INTO order_item_customizations
             (order_item_id, ingredient_id, ingredient_name, kind, quantity, unit_price)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [itemRes.rows[0].id, c.ingredientId, c.name, c.type, c.quantity, c.chargedPrice],
        );
      }
    }

    await client.query("COMMIT");
    res.status(201).json({
      success: true,
      orderId,
      subtotal,
      discount,
      total_price: total,
      coupon_code: appliedCoupon,
    });
  } catch (err) {
    await client.query("ROLLBACK");

    if (err instanceof CheckoutError) {
      return res.status(err.status).json({ error: err.message });
    }

    console.error("ERRO DETALHADO NO CHECKOUT:", err.message);

    res.status(500).json({
      error: "Erro ao processar pedido",
      details: err.message,
    });
  } finally {
    client.release();
  }
};

/** POST /orders/coupon/validate — usado pelo checkout para mostrar o desconto antes de enviar. */
export const createCouponValidationHandler = (pool) => async (req, res) => {
  const { code, customer_whatsapp } = req.body;
  try {
    const coupon = await resolveCoupon(pool, code, customer_whatsapp);
    res.json({ valid: true, code: coupon.code, percent: coupon.percent, description: coupon.description });
  } catch (err) {
    if (err instanceof CheckoutError) {
      return res.json({ valid: false, message: err.message });
    }
    console.error("Erro ao validar cupom:", err);
    res.status(500).json({ error: "Erro ao validar cupom" });
  }
};
