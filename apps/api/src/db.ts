import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";

export type Db = PrismaClient;

export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

let singleton: PrismaClient | undefined;

/** Process-wide client for the server entry point; tests use createPrismaClient directly. */
export function getDb(): PrismaClient {
  if (!singleton) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    singleton = createPrismaClient(connectionString);
  }
  return singleton;
}
