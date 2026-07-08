declare module 'better-sqlite3-session-store' {
  import type { Database } from 'better-sqlite3';
  import type session from 'express-session';

  interface SqliteStoreOptions {
    client: Database;
    expired?: {
      clear?: boolean;
      intervalMs?: number;
    };
  }

  type SqliteStoreConstructor = new (options: SqliteStoreOptions) => session.Store;

  export default function createSqliteStore(sessionModule: typeof session): SqliteStoreConstructor;
}
