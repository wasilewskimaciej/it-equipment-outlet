import { Request, Response, NextFunction } from 'express';
import { updateUserActivity } from '../db';

// In-memory cache: userId -> last activity update timestamp (ms)
const lastActivityCache = new Map<string, number>();

// Throttle: update DB at most once per 6 hours per user
const THROTTLE_MS = 6 * 60 * 60 * 1000;

export function trackActivity(req: Request, _res: Response, next: NextFunction): void {
  if (!req.isAuthenticated() || !req.user) {
    return next();
  }

  const userId = req.user.id;
  const now = Date.now();
  const lastUpdate = lastActivityCache.get(userId);

  if (!lastUpdate || (now - lastUpdate) >= THROTTLE_MS) {
    lastActivityCache.set(userId, now);
    // Async DB update - doesn't block the response
    setImmediate(() => {
      updateUserActivity(userId);
    });
  }

  next();
}
