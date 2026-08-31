import path from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

// Load the repo-root .env before the Prisma client reads DATABASE_URL, so the
// API resolves the correct database regardless of how it is launched (direct
// `npm run dev -w @kapmeta/api`, a fresh clone, or the startup orchestrator).
// Existing process env always wins, so an explicit override is still honored.
if (!process.env.DATABASE_URL) {
  loadEnv({ path: path.resolve(__dirname, "../../../.env") });
}

const globalForPrisma = globalThis as unknown as { kapmetaPrisma?: PrismaClient };

export const prisma = globalForPrisma.kapmetaPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.kapmetaPrisma = prisma;
}
