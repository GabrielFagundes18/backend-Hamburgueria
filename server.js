import express from "express";
import cors from "cors";
import productsRoutes from "./routes/products.js";
import ordersRoutes from "./routes/orders.js";
const app = express();
app.use(cors({
  origin: ["http://localhost:3000", "http://localhost:3001","hamburgueria-2mw1rmgp6-gabrielfagundesvv-6554s-projects.vercel.app"], // URLs dos seus dois projetos React
  methods: ["GET", "POST", "PATCH", "DELETE"],
  credentials: true
}));
app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// rotas

app.use("/products", productsRoutes);
app.use("/orders", ordersRoutes);


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));