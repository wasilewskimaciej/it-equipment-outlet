import { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.isAuthenticated() && req.user) {
    return next();
  }

  // For API requests, return 401
  if (req.originalUrl.startsWith('/api/')) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  // For page requests, redirect to login
  res.redirect('/auth/login');
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  // Prevent caching of admin pages
  if (!req.originalUrl.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  if (!req.isAuthenticated() || !req.user) {
    if (req.originalUrl.startsWith('/api/')) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    res.redirect('/auth/login');
    return;
  }

  if (!req.user.isAdmin) {
    if (req.originalUrl.startsWith('/api/')) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    res.status(403).json({ error: 'Brak uprawnień administratora' });
    return;
  }

  next();
}
