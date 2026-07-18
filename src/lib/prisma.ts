import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton.
 * Server-only — uses the pooled DATABASE_URL (PgBouncer) which is safe for
 * serverless; migrations use DIRECT_URL. Cached on globalThis so Next.js dev
 * hot-reload doesn't exhaust the connection pool.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
