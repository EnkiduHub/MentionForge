import { FETCH_POOL_MAX } from "./constants";

type Job<T> = () => Promise<T>;

export class FetchPool {
  private active = 0;
  private readonly q: Array<() => void> = [];

  constructor(private readonly max = FETCH_POOL_MAX) {}

  async run<T>(job: Job<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.q.push(resolve));
    }
    this.active++;
    try {
      return await job();
    } finally {
      this.active--;
      const next = this.q.shift();
      if (next) next();
    }
  }
}

export function abortMs(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}
