import type { IncomingMessage } from "node:http";
import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { graphql } from "ponder";
import { parseListQuery, parseTokenId } from "./params";
import { getProgress } from "./progress";
import { getPassport, listPassports } from "./queries";
import { indexerReadiness } from "./readiness";

/**
 * Summary API (`docs/TECHNICAL-REFERENCE.md`, "Indexer summary API") plus Ponder's GraphQL.
 * Responses carry token ids as decimal strings; the summary is derived per request from the
 * per-chain rows and the current progress, so it does not depend on ingestion order.
 */
const app = new Hono<{ Bindings: { incoming: IncomingMessage } }>();

app.use("/graphql", graphql({ db, schema }));
app.use("/", graphql({ db, schema }));

app.get("/api/status", async (c) => {
  const progress = await getProgress(c.env.incoming.socket.localPort);
  c.header("Cache-Control", "no-store");
  return c.json(indexerReadiness(progress));
});

app.get("/api/passports", async (c) => {
  const parsed = parseListQuery(c.req.query());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const progress = await getProgress(c.env.incoming.socket.localPort);
  return c.json(await listPassports(parsed.value, progress));
});

app.get("/api/passports/:tokenId", async (c) => {
  const parsed = parseTokenId(c.req.param("tokenId"));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const progress = await getProgress(c.env.incoming.socket.localPort);
  const summary = await getPassport(parsed.value, progress);
  if (!summary) return c.json({ error: "unknown token" }, 404);
  return c.json(summary);
});

export default app;
