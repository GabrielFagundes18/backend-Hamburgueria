import express from "express";
import pool from "../config/db.js";
const router = express.Router();

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

router.post("/checkout", async (req, res) => {
  console.log("Dados recebidos no body:", req.body);

  const {
    customer_name,
    customer_whatsapp,
    total_price,
    cep,
    address_street,
    address_number,
    address_complement,
    address_neighborhood,
    payment_method,
    change_details,
    notes,
    items, 
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

     const orderQuery = `
      INSERT INTO orders (
        customer_name, 
        customer_whatsapp, 
        total_price, 
        status, 
        cep, 
        address_street, 
        address_number, 
        address_complement, 
        address_neighborhood, 
        payment_method, 
        change_details, 
        notes,
        type
      ) VALUES ($1, $2, $3, 'pendente', $4, $5, $6, $7, $8, $9, $10, $11, 'website') 
      RETURNING id
    `;

    const orderValues = [
      customer_name,
      customer_whatsapp,
      total_price,
      cep,
      address_street,
      address_number,
      address_complement || "",
      address_neighborhood,
      payment_method,
      change_details || "N/A",
      notes || "Sem observações"
    ];

    const orderRes = await client.query(orderQuery, orderValues);
    const orderId = orderRes.rows[0].id;

    const itemQuery = `
      INSERT INTO order_items (order_id, product_id, quantity, unit_price) 
      VALUES ($1, $2, $3, $4)
    `;

    for (const item of items) {
      const productId = item.product_id || item.id; 
      
      if (!productId) {
        throw new Error("ID do produto não encontrado no item do carrinho");
      }

      await client.query(itemQuery, [
        orderId,
        productId,
        item.quantity,
        item.price,
      ]);
    }

    await client.query("COMMIT");
    res.status(201).json({ success: true, orderId });

  } catch (err) {
    if (client) await client.query("ROLLBACK");
    
    console.error("ERRO DETALHADO NO CHECKOUT:", err.message);
    
    res.status(500).json({ 
      error: "Erro ao processar pedido", 
      details: err.message 
    });
  } finally {
    client.release();
  }
});
export default router;