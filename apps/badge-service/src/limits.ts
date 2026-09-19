import { HTNOS_RATE_LIMIT } from '@htn/shared';

interface Bucket {
  tokens: number;
  at: number;
}

function consume(
  buckets: Map<string, Bucket>,
  key: string,
  amount: number,
  capacity: number,
  refillPerMs: number,
): boolean {
  const now = performance.now();
  const bucket = buckets.get(key) ?? { tokens: capacity, at: now };
  bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, now - bucket.at) * refillPerMs);
  bucket.at = now;
  if (bucket.tokens < amount) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.tokens -= amount;
  buckets.set(key, bucket);
  return true;
}

export class RateLimiter {
  private readonly commands = new Map<string, Bucket>();
  private readonly bytes = new Map<string, Bucket>();
  private readonly submissions = new Map<string, Bucket>();

  takeBadge(badgeId: string, byteLength: number): boolean {
    if (
      !consume(
        this.commands,
        badgeId,
        1,
        HTNOS_RATE_LIMIT.burst,
        HTNOS_RATE_LIMIT.commandsPerSecond / 1000,
      )
    ) {
      return false;
    }
    if (
      !consume(
        this.bytes,
        badgeId,
        byteLength,
        HTNOS_RATE_LIMIT.bytesPerSecond,
        HTNOS_RATE_LIMIT.bytesPerSecond / 1000,
      )
    ) {
      const bucket = this.commands.get(badgeId);
      if (bucket) bucket.tokens = Math.min(HTNOS_RATE_LIMIT.burst, bucket.tokens + 1);
      return false;
    }
    return true;
  }

  takeSubmission(ip: string): boolean {
    return consume(this.submissions, ip, 1, 10, 10 / 60_000);
  }
}
