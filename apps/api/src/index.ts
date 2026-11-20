import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { getDb } from "./db.ts";
import { loadEnv, loadLocalEnv } from "./env.ts";
import { masterKeyFromHex } from "./lib/crypto.ts";

loadLocalEnv();
const env = loadEnv();

const app = createApp({
  db: getDb(),
  adminToken: env.ADMIN_TOKEN,
  masterKey: masterKeyFromHex(env.ENCRYPTION_MASTER_KEY),
});

// LAN-only product: plain HTTP on all interfaces, no TLS in M1.
serve({ fetch: app.fetch, hostname: "0.0.0.0", port: env.PORT }, (info) => {
  console.log(`passe•trou listening on 0.0.0.0:${info.port}`);
});
