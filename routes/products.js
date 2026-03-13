import express from "express";
import pool from "../config/db.js";
const router = express.Router();

// --- ROTA DO CARDÁPIO ---
// Busca produtos e aceita filtro por categoria: /api/products?category=burgers
router.get("/", async (req, res) => {
  const { category } = req.query;
  try {
    let query = "SELECT * FROM products WHERE available = TRUE";
    const params = [];

    if (category && category !== "todos") {
      query += " AND category = $1";
      params.push(category);
    }

    query += " ORDER BY name ASC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("Erro ao buscar produtos:", err);
    res.status(500).json({ error: "Erro interno ao carregar cardápio" });
  }
});

// --- ROTA DO CHECKOUT (PEDIDOS) ---
// Salva o cliente e os itens que ele comprou
router.post("/checkout", async (req, res) => {
  const { customer_name, customer_whatsapp, items, total_price } = req.body;

  // Iniciamos uma transação para garantir que o pedido só seja salvo se os itens também forem
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Insere o pedido principal na tabela 'orders'
    const orderQuery = `
            INSERT INTO orders (customer_name, customer_whatsapp, total_price, status) 
            VALUES ($1, $2, $3, 'pendente') 
            RETURNING id
        `;
    const orderRes = await client.query(orderQuery, [
      customer_name,
      customer_whatsapp,
      total_price,
    ]);
    const orderId = orderRes.rows[0].id;

    // 2. Insere cada item do carrinho na tabela 'order_items'
    const itemQuery = `
            INSERT INTO order_items (order_id, product_id, quantity, unit_price) 
            VALUES ($1, $2, $3, $4)
        `;

    for (const item of items) {
      await client.query(itemQuery, [
        orderId,
        item.id,
        item.quantity,
        item.price,
      ]);
    }

    await client.query("COMMIT");
    res.status(201).json({
      success: true,
      message: "Pedido Ninja recebido!",
      orderId,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro ao processar checkout:", err);
    res.status(500).json({ error: "Falha ao finalizar pedido" });
  } finally {
    client.release();
  }
});






export default router;
