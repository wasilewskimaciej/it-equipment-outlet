import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type DbModule = typeof import('../src/db');

let tempDir: string;

let dbModule: DbModule;

describe('deleteUser', () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = 'test-session-secret';
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'it-equipment-test-'));
    process.env.DATABASE_PATH = path.join(tempDir, 'database.db');
    dbModule = await import('../src/db');
    dbModule.initializeDatabase();
  });

  afterAll(() => {
    dbModule.db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('preserves completed reservation history and sales stats when deleting a buyer', () => {
    const buyer = dbModule.findOrCreateUser('buyer-1', 'buyer-1@example.com', 'Buyer 1', false);
    const item = dbModule.createItem({
      name: 'Dell Monitor 24',
      category: 'monitor',
      quantity: 1,
      isVisible: 1,
      price: 100
    });

    const reservation = dbModule.createReservation(item.id, buyer.id);
    expect(reservation).not.toBeNull();

    const completed = dbModule.completeReservation(reservation!.id);
    expect(completed).toBe(true);

    const beforeDelete = dbModule.getAllItemsWithImagesAndFavorites()[0];
    expect(beforeDelete.soldCount).toBe(1);
    expect(beforeDelete.soldValue).toBe(100);
    expect(beforeDelete.buyers).toBe('Buyer 1');

    const deleted = dbModule.deleteUser(buyer.id);
    expect(deleted).toBe(true);

    const afterDelete = dbModule.getAllItemsWithImagesAndFavorites()[0];
    expect(afterDelete.soldCount).toBe(1);
    expect(afterDelete.soldValue).toBe(100);
    expect(afterDelete.buyers).toBe('Deleted User');

    const historyCount = dbModule.db
      .prepare("SELECT COUNT(*) as count FROM reservation_history WHERE status = 'completed'")
      .get() as { count: number };
    expect(historyCount.count).toBe(1);
  });
});
