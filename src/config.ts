import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Parse local accounts from env (format: LOCAL_ACCOUNTS=user1:pass1:display1:admin,user2:pass2:display2:user)
function parseLocalAccounts(): Array<{
  username: string;
  password: string;
  displayName: string;
  isAdmin: boolean;
}> {
  const accountsStr = process.env.LOCAL_ACCOUNTS || '';
  if (!accountsStr) return [];

  return accountsStr.split(',').map((acc) => {
    const [username, password, displayName, role] = acc.split(':');
    return {
      username: username?.trim() || '',
      password: password?.trim() || '',
      displayName: displayName?.trim() || username?.trim() || '',
      isAdmin: role?.trim().toLowerCase() === 'admin'
    };
  }).filter((acc) => acc.username && acc.password);
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',

  azure: {
    clientId: process.env.AZURE_CLIENT_ID || '',
    clientSecret: process.env.AZURE_CLIENT_SECRET || '',
    tenantId: process.env.AZURE_TENANT_ID || '',
    redirectUri: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/callback`,
    enabled: !!(process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.AZURE_TENANT_ID)
  },

  // Local accounts (parsed from LOCAL_ACCOUNTS env var)
  localAccounts: parseLocalAccounts(),

  // Login security
  loginSecurity: {
    maxAttempts: parseInt(process.env.LOGIN_MAX_ATTEMPTS || '5', 10),
    lockoutMinutes: parseInt(process.env.LOGIN_LOCKOUT_MINUTES || '15', 10)
  },

  session: {
    secret: requireEnv('SESSION_SECRET')
  },

  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  smtp: {
    host: process.env.SMTP_HOST || 'smtp.example.com',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    notificationEmail: process.env.NOTIFICATION_EMAIL || ''
  },

  paths: {
    database: process.env.DATABASE_PATH
      ? path.resolve(process.env.DATABASE_PATH)
      : path.join(__dirname, '..', 'data', 'database.db'),
    uploads: path.join(__dirname, '..', 'public', 'images')
  }
};
