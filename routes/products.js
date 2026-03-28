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








export default router;
