import express from "express";
import pool from "../config/db.js"; // Verifica se o caminho do teu pool está certo
const router = express.Router();

router.post("/", async (req, res) => {
  const { customer_name, customer_whatsapp, items, total_price } = req.body;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Salva o pedido
   const orderRes = await client.query(
  "INSERT INTO orders (customer_name, customer_whatsapp, total_price, status) VALUES ($1, $2, $3, 'pendente') RETURNING id",
  [customer_name, customer_whatsapp, total_price] // Aqui vão os dados do CLIENTE
);

const orderId = orderRes.rows[0].id; // Pegamos o ID gerado para usar abaixo

// 2. DEPOIS: Salva cada item na tabela 'order_items' dentro do loop
for (const item of items) {
  await client.query(
    "INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)",
    [
      orderId,          // ID que acabou de ser criado acima
      item.product_id,  // ID do lanche
      item.quantity,    // Quantidade
      item.price        // Preço unitário
    ]
  );
}

    await client.query("COMMIT");
    res.status(201).json({ success: true, orderId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erro ao salvar no banco" });
  } finally {
    client.release();
  }
});

export default router;