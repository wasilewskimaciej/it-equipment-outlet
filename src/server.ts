import express from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { config } from './config';
import { initializeDatabase } from './db';
import { passport } from './auth';
import { requireAdmin } from './middleware/auth.middleware';
import { csrfProtection } from './middleware/csrf.middleware';
import { trackActivity } from './middleware/activity.middleware';
import { logger, getRequestInfo } from './logger';

import authRoutes from './routes/auth.routes';
import itemsRoutes from './routes/items.routes';
import reservationsRoutes from './routes/reservations.routes';
import usersRoutes from './routes/users.routes';
import favoritesRoutes from './routes/favorites.routes';

const app = express();

// Trust proxy (needed for secure cookies behind Nginx)
app.set('trust proxy', 1);

// Initialize database
initializeDatabase();

logger.info('Server starting', {
  details: {
    port: config.port,
    baseUrl: config.baseUrl,
    azureEnabled: config.azure.enabled,
    localAccountsCount: config.localAccounts.length
  }
});

// HTTPS enforcement in production
if (config.baseUrl.startsWith('https')) {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// Security headers
app.disable('x-powered-by'); // Hide Express fingerprint
app.use((req, res, next) => {
  // Content Security Policy - allows inline scripts and Cloudflare Web Analytics
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; " +
    "connect-src 'self' https://cloudflareinsights.com; " +
    "font-src 'self'"
  );
  // Prevent clickjacking - don't allow embedding in iframes
  res.setHeader('X-Frame-Options', 'DENY');
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session
app.use(
  session({
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      secure: config.baseUrl.startsWith('https'),
      httpOnly: true,
      // Note: sameSite not set to allow Microsoft OAuth callback (cross-site POST)
      // CSRF protection handled by OAuth state parameter instead
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days, rolling
    }
  })
);

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Reject cross-site state-changing requests for authenticated sessions.
// The Microsoft OAuth callback is exempted inside the middleware.
app.use(csrfProtection);

// Track user activity (throttled: max 1 DB write per 6h per user)
app.use(trackActivity);

// Block admin pages from static serving - must come before express.static
app.use('/admin.html', requireAdmin);
app.use('/admin', requireAdmin);

// Static files (public folder)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rate limiting for reservation endpoint (10 requests per hour per user)
const reservationRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 requests per hour
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => {
    // Use user ID if authenticated, otherwise use a default key
    // (logged in users are always identified by their ID)
    return req.user?.id || 'anonymous';
  },
  handler: (req, res) => {
    logger.warn('Rate limit exceeded for reservations', {
      ...getRequestInfo(req),
      action: 'RATE_LIMIT_EXCEEDED'
    });
    res.status(429).json({
      error: 'Zbyt wiele prób rezerwacji. Spróbuj ponownie za godzinę.'
    });
  }
});

// Routes
app.use('/auth', authRoutes);
app.use('/api/items', itemsRoutes);
// Apply rate limiter to POST /api/reservations before the route handler
app.use('/api/reservations', (req, res, next) => {
  // Apply rate limiter only to regular user reservation POSTs, not admin-order
  if (req.method === 'POST' && req.path === '/') {
    return reservationRateLimiter(req, res, next);
  }
  next();
}, reservationsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/favorites', favoritesRoutes);

// Protected pages
app.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    res.sendFile(path.join(__dirname, '..', 'public', 'catalog.html'));
  } else {
    res.redirect('/auth/login');
  }
});

app.get('/admin.html', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.get('/admin/users.html', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'users.html'));
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', {
    ...getRequestInfo(req),
    error: err.message,
    details: { stack: err.stack }
  });
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(config.port, () => {
  logger.info('Server started successfully', {
    details: {
      port: config.port,
      baseUrl: config.baseUrl,
      adminEmails: config.adminEmails
    }
  });
  console.log(`Server running at ${config.baseUrl}`);
});
