import { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { logger, getRequestInfo } from '../logger';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT_PATHS = new Set(['/auth/callback']);

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function extractOrigin(value: string | undefined): string | null {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const appOrigin = extractOrigin(config.baseUrl);

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const requestPath = req.originalUrl.split('?')[0];
  if (EXEMPT_PATHS.has(requestPath)) {
    next();
    return;
  }

  if (!appOrigin || !req.isAuthenticated || !req.isAuthenticated()) {
    next();
    return;
  }

  const origin = extractOrigin(getHeaderValue(req.headers.origin));
  const refererOrigin = extractOrigin(getHeaderValue(req.headers.referer));
  const isAllowed = origin === appOrigin || refererOrigin === appOrigin;

  if (isAllowed) {
    next();
    return;
  }

  logger.warn('Blocked request with invalid CSRF origin', {
    ...getRequestInfo(req),
    action: 'CSRF_BLOCKED',
    details: {
      method: req.method,
      path: requestPath,
      origin: origin || null,
      refererOrigin: refererOrigin || null,
      expectedOrigin: appOrigin
    }
  });

  if (req.originalUrl.startsWith('/api/')) {
    res.status(403).json({ error: 'Invalid request origin' });
    return;
  }

  res.status(403).send('Forbidden');
}
