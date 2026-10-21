import { createHash } from 'node:crypto'

type Attempt = { failures: number; blockedUntil: number; lastAttempt: number }

/** In-memory limiter: it never stores a login or password in plain text. */
export class LoginRateLimiter {
  private readonly attempts = new Map<string, Attempt>()

  private key(address: string, username: unknown): string {
    const login = typeof username === 'string' ? username.normalize('NFKC').trim().toLocaleLowerCase('uk-UA') : ''
    return createHash('sha256').update(`${address}\u0000${login}`).digest('hex')
  }

  isBlocked(address: string, username: unknown, now = Date.now()): boolean {
    this.removeStale(now)
    const attempt = this.attempts.get(this.key(address, username))
    return !!attempt && attempt.blockedUntil > now
  }

  failed(address: string, username: unknown, now = Date.now()): void {
    this.removeStale(now)
    const key = this.key(address, username)
    const previous = this.attempts.get(key)
    const failures = (previous?.failures ?? 0) + 1
    // Five failures pause only this address/login combination for fifteen minutes.
    this.attempts.set(key, { failures, blockedUntil: failures >= 5 ? now + 15 * 60 * 1000 : 0, lastAttempt: now })
  }

  succeeded(address: string, username: unknown): void {
    this.attempts.delete(this.key(address, username))
  }

  private removeStale(now: number): void {
    for (const [key, attempt] of this.attempts) {
      if (attempt.lastAttempt < now - 30 * 60 * 1000 && attempt.blockedUntil <= now) this.attempts.delete(key)
    }
  }
}
