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
      hint: "A real Cloudflare Workers research result, frozen as a free sample so you can inspect the format. Not live traffic.",
    },
  );
});
