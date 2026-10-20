import express from "express";
import pool from "../config/db.js";
import { createCheckoutHandler, createCouponValidationHandler } from "../services/checkout.js";
import { listMenuProducts } from "../services/menu.js";
const router = express.Router();

// Mesma lista de GET /products (rota antiga mantida por compatibilidade).
router.get("/", async (req, res) => {
  try {
    res.json(await listMenuProducts(pool, req.query.category));
  } catch (err) {
    console.error("Erro ao buscar produtos:", err);
    res.status(500).json({ error: "Erro interno ao carregar cardápio" });
  }
});

router.post("/checkout", createCheckoutHandler(pool));

router.post("/coupon/validate", createCouponValidationHandler(pool));

export default router;
