import passport from 'passport';
import { OIDCStrategy, IOIDCStrategyOptionWithRequest, IProfile, VerifyCallback } from 'passport-azure-ad';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcrypt';
import { config } from './config';
import { findOrCreateUser, getUserById } from './db';
import { Request } from 'express';
import crypto from 'crypto';
import { logger } from './logger';

// User type for session
declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      displayName: string;
      isAdmin: boolean;
    }
  }
}

// Track failed login attempts (in-memory, resets on server restart)
const failedAttempts: Map<string, { count: number; lockedUntil: number | null }> = new Map();

// Check if account is locked
function isAccountLocked(username: string): { locked: boolean; remainingMinutes: number } {
  const record = failedAttempts.get(username);
  if (!record || !record.lockedUntil) {
    return { locked: false, remainingMinutes: 0 };
  }

  const now = Date.now();
  if (now < record.lockedUntil) {
    const remainingMs = record.lockedUntil - now;
    const remainingMinutes = Math.ceil(remainingMs / 60000);
    return { locked: true, remainingMinutes };
  }

  // Lock expired, reset
  failedAttempts.delete(username);
  return { locked: false, remainingMinutes: 0 };
}

// Record failed login attempt
function recordFailedAttempt(username: string): { locked: boolean; attemptsLeft: number } {
  const record = failedAttempts.get(username) || { count: 0, lockedUntil: null };
  record.count += 1;

  if (record.count >= config.loginSecurity.maxAttempts) {
    record.lockedUntil = Date.now() + config.loginSecurity.lockoutMinutes * 60 * 1000;
    failedAttempts.set(username, record);

    logger.warn('Account locked due to failed login attempts', {
      action: 'ACCOUNT_LOCKED',
      details: {
        username,
        attempts: record.count,
        lockoutMinutes: config.loginSecurity.lockoutMinutes
      }
    });

    return { locked: true, attemptsLeft: 0 };
  }

  failedAttempts.set(username, record);
  return { locked: false, attemptsLeft: config.loginSecurity.maxAttempts - record.count };
}

// Clear failed attempts on successful login
function clearFailedAttempts(username: string): void {
  failedAttempts.delete(username);
}

// Azure AD Strategy (only if configured)
if (config.azure.enabled) {
  const strategyOptions: IOIDCStrategyOptionWithRequest = {
    identityMetadata: `https://login.microsoftonline.com/${config.azure.tenantId}/v2.0/.well-known/openid-configuration`,
    clientID: config.azure.clientId,
    clientSecret: config.azure.clientSecret,
    responseType: 'code',
    responseMode: 'form_post',
    redirectUrl: config.azure.redirectUri,
    allowHttpForRedirectUrl: config.baseUrl.startsWith('http://localhost'),
    scope: ['openid', 'profile', 'email'],
    passReqToCallback: true
  };

  passport.use(
    new OIDCStrategy(
      strategyOptions,
      (req: Request, profile: IProfile, done: VerifyCallback) => {
        try {
          const id = profile.oid || profile.sub || '';
          const email = (profile._json?.email || profile.upn || '').toLowerCase();
          const displayName = profile.displayName || email;

          if (!id || !email) {
            return done(new Error('Invalid profile data from Microsoft'));
          }

          const isAdmin = config.adminEmails.includes(email);
          const user = findOrCreateUser(id, email, displayName, isAdmin);

          return done(null, user);
        } catch (error) {
          return done(error as Error);
        }
      }
    )
  );
}

// Local Strategy for local accounts
if (config.localAccounts.length > 0) {
  passport.use(
    new LocalStrategy(
      {
        usernameField: 'username',
        passwordField: 'password'
      },
      (username: string, password: string, done) => {
        try {
          // Check if account is locked
          const lockStatus = isAccountLocked(username);
          if (lockStatus.locked) {
            logger.warn('Login attempt on locked account', {
              action: 'LOGIN_BLOCKED',
              details: { username, remainingMinutes: lockStatus.remainingMinutes }
            });
            return done(null, false, {
              message: `Konto zablokowane. Spróbuj ponownie za ${lockStatus.remainingMinutes} min.`
            });
          }

          // Find matching account
          const account = config.localAccounts.find(
            (acc) => acc.username === username && bcrypt.compareSync(password, acc.password)
          );

          if (account) {
            // Successful login - clear failed attempts
            clearFailedAttempts(username);

            const userId = `local_${crypto.createHash('sha256').update(account.username).digest('hex').substring(0, 16)}`;
            const userEmail = `${account.username}@local`;
            const user = findOrCreateUser(userId, userEmail, account.displayName, account.isAdmin);

            logger.info('Local account login successful', {
              action: 'LOGIN_SUCCESS',
              details: { username: account.username, isAdmin: account.isAdmin }
            });

            return done(null, user);
          }

          // Failed login - record attempt
          const result = recordFailedAttempt(username);

          if (result.locked) {
            return done(null, false, {
              message: `Konto zablokowane na ${config.loginSecurity.lockoutMinutes} minut po ${config.loginSecurity.maxAttempts} nieudanych próbach.`
            });
          }

          logger.warn('Failed login attempt', {
            action: 'LOGIN_FAILED',
            details: { username, attemptsLeft: result.attemptsLeft }
          });

          return done(null, false, {
            message: `Nieprawidłowa nazwa użytkownika lub hasło. Pozostało prób: ${result.attemptsLeft}`
          });
        } catch (error) {
          return done(error as Error);
        }
      }
    )
  );
}

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id: string, done) => {
  try {
    const user = getUserById(id);
    done(null, user);
  } catch (error) {
    done(error);
  }
});

export { passport };
