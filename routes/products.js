import express from "express";
import pool from "../config/db.js";
import { getCustomizationCatalog } from "../services/customization.js";
import { listMenuProducts } from "../services/menu.js";
const router = express.Router();

router.get("/", async (req, res) => {
  const { category } = req.query;
  try {
    // Lanches com algum ingrediente sem estoque ficam fora do cardápio.
    res.json(await listMenuProducts(pool, category));
  } catch (err) {
    console.error("Erro ao buscar produtos:", err);
    res.status(500).json({ error: "Erro interno ao carregar cardápio" });
  }
});

// Ingredientes, adicionais e opções do "Monte seu Lanche".
router.get("/customizations", async (req, res) => {
  try {
    res.json(await getCustomizationCatalog(pool));
  } catch (err) {
    console.error("Erro ao buscar personalizações:", err);
    res.status(500).json({ error: "Erro ao carregar personalizações" });
  }
});

export default router;
