import fs from 'fs';
import path from 'path';

const logsDir = path.join(__dirname, '..', 'logs');

// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

function getLogFileName(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}.log`;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'ACTION';

interface LogData {
  userId?: string;
  userEmail?: string;
  action?: string;
  details?: Record<string, unknown>;
  error?: string;
  ip?: string;
  userAgent?: string;
}

function writeLog(level: LogLevel, message: string, data?: LogData): void {
  const timestamp = formatTimestamp();
  const logFile = path.join(logsDir, getLogFileName());

  const logEntry = {
    timestamp,
    level,
    message,
    ...data
  };

  const logLine = JSON.stringify(logEntry) + '\n';

  // Write to file
  fs.appendFileSync(logFile, logLine, 'utf8');

  // Also log to console in development
  if (process.env.NODE_ENV !== 'production') {
    const consoleMessage = `[${timestamp}] [${level}] ${message}`;
    if (level === 'ERROR') {
      console.error(consoleMessage, data || '');
    } else {
      console.log(consoleMessage, data || '');
    }
  }
}

export const logger = {
  info(message: string, data?: LogData): void {
    writeLog('INFO', message, data);
  },

  warn(message: string, data?: LogData): void {
    writeLog('WARN', message, data);
  },

  error(message: string, data?: LogData): void {
    writeLog('ERROR', message, data);
  },

  action(message: string, data?: LogData): void {
    writeLog('ACTION', message, data);
  }
};

// Helper to extract request info
export function getRequestInfo(req: { ip?: string; headers?: Record<string, string | string[] | undefined>; user?: { id: string; email: string } }): LogData {
  return {
    userId: req.user?.id,
    userEmail: req.user?.email,
    ip: req.ip || (req.headers?.['x-forwarded-for'] as string) || 'unknown',
    userAgent: req.headers?.['user-agent'] as string | undefined
  };
}
