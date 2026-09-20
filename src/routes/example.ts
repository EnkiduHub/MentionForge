import { Hono } from "hono";
import { EXAMPLE_RESPONSE } from "../lib/example";
import { sendPublic } from "../lib/http-json";

export const exampleRoutes = new Hono<{ Bindings: Env }>();

exampleRoutes.get("/v1/research/example", (c) => {
  return sendPublic(
    c,
    EXAMPLE_RESPONSE,
    200,
    { "Cache-Control": "public, max-age=60, must-revalidate" },
    {
      title: "Example snapshot",
      hint: "Free fixture of a real Cloudflare Workers research call. Not live traffic.",
    },
  );
});
