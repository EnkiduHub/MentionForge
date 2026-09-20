import { AgentError } from "../schemas/errors";

export async function limitOrThrow(
  limiter: RateLimit | undefined,
  key: string,
  requestId: string,
  retryAfter = 60,
): Promise<void> {
  if (!limiter) return;
  try {
    const { success } = await limiter.limit({ key });
    if (!success) {
      throw new AgentError("RATE_LIMITED", "Rate limit exceeded.", {
        request_id: requestId,
        details: { retry_after: retryAfter },
        hint: `Wait ${retryAfter}s then retry with the same Idempotency-Key.`,
      });
    }
  } catch (err) {
    if (err instanceof AgentError) throw err;
  }
}
