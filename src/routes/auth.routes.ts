import { Router, Request, Response, NextFunction } from 'express';
import { passport } from '../auth';
import { config } from '../config';
import { logger, getRequestInfo } from '../logger';
import { updateUserLastLogin } from '../db';

const router = Router();

// HTML escaping helper to prevent XSS
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Login page - shows options based on config
router.get('/login', (req: Request, res: Response, next: NextFunction) => {
  // If Azure is enabled and no local accounts OR explicit Microsoft login
  const hasLocalAccounts = config.localAccounts.length > 0;
  if (config.azure.enabled && !hasLocalAccounts) {
    return passport.authenticate('azuread-openidconnect', {
      failureRedirect: '/auth/login-page'
    } as object)(req, res, next);
  }

  // Show login page with options
  res.redirect('/auth/login-page');
});

// Login page HTML
router.get('/login-page', (req: Request, res: Response) => {
  const showLocal = config.localAccounts.length > 0;

  let html = `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <title>Logowanie - IT Equipment Outlet</title>
  <link rel="stylesheet" href="/css/style.css">
  <script src="/js/theme.js"></script>
  <style>
    body { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .login-container {
      max-width: 400px;
      margin: auto;
      padding: 2rem;
      background: var(--bg-secondary);
      border-radius: 8px;
      box-shadow: 0 2px 10px var(--shadow-color);
    }
    .login-container h1 { text-align: center; margin-bottom: 2rem; color: var(--accent-color); }
    .login-divider { text-align: center; margin: 1.5rem 0; color: var(--text-muted); position: relative; }
    .login-divider::before, .login-divider::after {
      content: ''; position: absolute; top: 50%; width: 40%; height: 1px; background: var(--border-color);
    }
    .login-divider::before { left: 0; }
    .login-divider::after { right: 0; }
    .btn-microsoft {
      background: #2f2f2f;
      width: 100%;
      padding: 1.25rem 1.5rem;
      margin-bottom: 1.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.1rem;
      font-weight: 500;
      border-radius: 6px;
      text-decoration: none;
      color: white;
      transition: background 0.2s, transform 0.1s;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    .btn-microsoft:hover { background: #1a1a1a; transform: translateY(-1px); }
    .btn-microsoft svg { width: 24px; height: 24px; margin-right: 12px; }
    .tester-link {
      text-align: center;
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border-color);
    }
    .tester-link a {
      color: var(--text-muted);
      font-size: 0.8rem;
      text-decoration: none;
    }
    .tester-link a:hover { text-decoration: underline; }
    .error-message { background: var(--error-bg); color: var(--error-text); padding: 0.75rem; border-radius: 4px; margin-bottom: 1rem; }
    .theme-toggle-login { position: absolute; top: 1rem; right: 1rem; background: var(--bg-secondary); border: 1px solid var(--border-color); }
  </style>
</head>
<body>
  <button class="theme-toggle theme-toggle-login" onclick="toggleTheme()" title="Zmień motyw">
    <span class="icon-sun">&#9728;</span>
    <span class="icon-moon">&#9790;</span>
  </button>
  <div class="login-container">
    <h1>IT Equipment Outlet</h1>
    ${req.query.error ? `<div class="error-message">${escapeHtml(String(req.query.error))}</div>` : ''}
`;

  // Always show Microsoft button (primary login method for employees)
  html += `
    <a href="/auth/microsoft" class="btn btn-microsoft">
      <svg width="20" height="20" viewBox="0 0 21 21" style="vertical-align: middle; margin-right: 8px;">
        <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
        <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
        <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
        <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
      </svg>
      Zaloguj się kontem Microsoft
    </a>
`;

  if (showLocal) {
    html += `
    <div class="tester-link">
      <a href="/auth/local-login">Jestem testerem/administratorem</a>
    </div>
`;
  }


  html += `
  </div>
</body>
</html>
`;

  res.send(html);
});

// Local login page (for testers only)
router.get('/local-login', (req: Request, res: Response) => {
  if (config.localAccounts.length === 0) {
    return res.redirect('/auth/login-page?error=Logowanie lokalne nie jest dostępne');
  }

  const html = `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Logowanie testera - IT Equipment Outlet</title>
  <link rel="stylesheet" href="/css/style.css">
  <script src="/js/theme.js"></script>
  <style>
    body { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .login-container {
      max-width: 360px;
      margin: auto;
      padding: 1.5rem;
      background: var(--bg-secondary);
      border-radius: 8px;
      box-shadow: 0 2px 10px var(--shadow-color);
    }
    .login-container h2 { text-align: center; margin-bottom: 0.5rem; color: var(--text-primary); font-size: 1.1rem; }
    .login-container .subtitle { text-align: center; color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1.5rem; }
    .error-message { background: var(--error-bg); color: var(--error-text); padding: 0.75rem; border-radius: 4px; margin-bottom: 1rem; font-size: 0.9rem; }
    .back-link { text-align: center; margin-top: 1.5rem; }
    .back-link a { color: var(--text-muted); font-size: 0.85rem; }
    .theme-toggle-login { position: absolute; top: 1rem; right: 1rem; background: var(--bg-secondary); border: 1px solid var(--border-color); }
  </style>
</head>
<body>
  <button class="theme-toggle theme-toggle-login" onclick="toggleTheme()" title="Zmień motyw">
    <span class="icon-sun">&#9728;</span>
    <span class="icon-moon">&#9790;</span>
  </button>
  <div class="login-container">
    <h2>Konto testowe</h2>
    <p class="subtitle">Tylko dla testerów i administratorów</p>
    ${req.query.error ? `<div class="error-message">${escapeHtml(String(req.query.error))}</div>` : ''}
    <form action="/auth/local" method="POST">
      <div class="form-group">
        <label for="username">Login</label>
        <input type="text" id="username" name="username" required autocomplete="username">
      </div>
      <div class="form-group">
        <label for="password">Hasło</label>
        <input type="password" id="password" name="password" required autocomplete="current-password">
      </div>
      <button type="submit" class="btn btn-primary" style="width: 100%;">Zaloguj</button>
    </form>
    <div class="back-link">
      <a href="/auth/login-page">← Wróć do logowania Microsoft</a>
    </div>
  </div>
</body>
</html>
`;

  res.send(html);
});

// Microsoft login
router.get('/microsoft', (req: Request, res: Response, next: NextFunction) => {
  if (!config.azure.enabled) {
    return res.redirect('/auth/login-page?error=Logowanie Microsoft nie jest skonfigurowane');
  }
  passport.authenticate('azuread-openidconnect', {
    failureRedirect: '/auth/login-page?error=Logowanie Microsoft nie powiodło się'
  } as object)(req, res, next);
});

// Callback from Microsoft
router.post(
  '/callback',
  passport.authenticate('azuread-openidconnect', {
    failureRedirect: '/auth/login-page?error=Logowanie Microsoft nie powiodło się',
    failureMessage: true
  }),
  (req: Request, res: Response) => {
    if (req.user) {
      updateUserLastLogin(req.user.id);
    }
    logger.action('User logged in via Microsoft', {
      ...getRequestInfo(req),
      action: 'LOGIN_MICROSOFT'
    });
    res.redirect('/');
  }
);

// Local login
router.post('/local', (req: Request, res: Response, next: NextFunction) => {
  if (config.localAccounts.length === 0) {
    logger.warn('Local login attempt when disabled', getRequestInfo(req));
    return res.redirect('/auth/login-page?error=Logowanie lokalne nie jest dostępne');
  }

  passport.authenticate('local', (err: Error | null, user: Express.User | false, info: { message?: string }) => {
    if (err) {
      logger.error('Local login error', { ...getRequestInfo(req), error: err.message });
      return res.redirect('/auth/local-login?error=Błąd serwera');
    }
    if (!user) {
      logger.warn('Failed local login attempt', {
        ...getRequestInfo(req),
        action: 'LOGIN_FAILED',
        details: { username: req.body?.username }
      });
      return res.redirect('/auth/local-login?error=Nieprawidłowy login lub hasło');
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        logger.error('Login session error', { ...getRequestInfo(req), error: loginErr.message });
        return res.redirect('/auth/local-login?error=Błąd logowania');
      }
      updateUserLastLogin(user.id);
      logger.action('User logged in via local account', {
        ...getRequestInfo(req),
        action: 'LOGIN_LOCAL'
      });
      return res.redirect('/');
    });
  })(req, res, next);
});

// Logout confirmation page for stale bookmarks or manual navigation.
router.get('/logout', (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/auth/login-page');
  }

  res.send(`
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wylogowanie - IT Equipment Outlet</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <main class="container" style="max-width: 480px; padding-top: 4rem;">
    <section class="admin-section">
      <h1 style="margin-top: 0;">Wylogowanie</h1>
      <p>Aby zakończyć sesję, potwierdź wylogowanie przyciskiem poniżej.</p>
      <form action="/auth/logout" method="POST" style="display: inline;">
        <button type="submit" class="btn btn-secondary">Wyloguj</button>
      </form>
      <a href="/" class="btn btn-primary" style="margin-left: 0.75rem;">Anuluj</a>
    </section>
  </main>
</body>
</html>
  `);
});

// Logout
router.post('/logout', (req: Request, res: Response, next: NextFunction) => {
  const userInfo = getRequestInfo(req);
  logger.action('User logged out', { ...userInfo, action: 'LOGOUT' });

  req.logout((err) => {
    if (err) {
      logger.error('Logout error', { ...userInfo, error: err.message });
      return next(err);
    }
    req.session.destroy(() => {
      res.redirect('/auth/login-page');
    });
  });
});

// Get current user info
router.get('/me', (req: Request, res: Response) => {
  if (req.isAuthenticated() && req.user) {
    res.json({
      id: req.user.id,
      email: req.user.email,
      displayName: req.user.displayName,
      isAdmin: req.user.isAdmin
    });
  } else {
    res.json(null);
  }
});

export default router;
