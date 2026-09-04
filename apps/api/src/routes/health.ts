import { Router } from "express";
import { prisma } from "../prisma";

const router = Router();

router.get(["/", "/health"], async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "OK", db: "UP", timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("Health check failed:", error);
    res.status(503).json({ status: "ERROR", db: "DOWN", timestamp: new Date().toISOString() });
  }
});

export { router as healthRouter };
