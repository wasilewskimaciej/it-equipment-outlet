import Database, { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { config } from './config';

// Ensure data directory exists
const dataDir = path.dirname(config.paths.database);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db: DatabaseType = new Database(config.paths.database);

// Enable foreign keys
db.pragma('foreign_keys = ON');

const DELETED_USER_ID = 'deleted_user';
const DELETED_USER_EMAIL = 'deleted-user@system.invalid';
const DELETED_USER_DISPLAY_NAME = 'Deleted User';

// Initialize schema
export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      displayName TEXT NOT NULL,
      isAdmin INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      imagePath TEXT,
      price REAL,
      status TEXT DEFAULT 'available',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      createdBy TEXT,
      FOREIGN KEY (createdBy) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      itemId INTEGER NOT NULL,
      userId TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (itemId) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS item_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      itemId INTEGER NOT NULL,
      imagePath TEXT NOT NULL,
      sortOrder INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (itemId) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
    CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
    CREATE INDEX IF NOT EXISTS idx_item_images_itemId ON item_images(itemId);

    CREATE TABLE IF NOT EXISTS reservation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      itemId INTEGER NOT NULL,
      userId TEXT NOT NULL,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      completedAt TEXT,
      cancelledAt TEXT,
      FOREIGN KEY (itemId) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_reservation_history_itemId ON reservation_history(itemId);

    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      itemId INTEGER NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (itemId) REFERENCES items(id) ON DELETE CASCADE,
      UNIQUE(userId, itemId)
    );

    CREATE INDEX IF NOT EXISTS idx_favorites_userId ON favorites(userId);
    CREATE INDEX IF NOT EXISTS idx_favorites_itemId ON favorites(itemId);

    CREATE TABLE IF NOT EXISTS favorite_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      itemId INTEGER NOT NULL,
      action TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (itemId) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_favorite_history_createdAt ON favorite_history(createdAt);

    CREATE TABLE IF NOT EXISTS item_edit_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      itemId INTEGER NOT NULL,
      userId TEXT NOT NULL,
      changes TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (itemId) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_item_edit_history_itemId ON item_edit_history(itemId);
  `);

  // Migrate existing images to new table
  migrateExistingImages();

  // Add lastLoginAt column if it doesn't exist
  try {
    db.exec(`ALTER TABLE users ADD COLUMN lastLoginAt TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Add createdBy column to items if it doesn't exist
  try {
    db.exec(`ALTER TABLE items ADD COLUMN createdBy TEXT REFERENCES users(id)`);
  } catch {
    // Column already exists, ignore
  }

  // Add adminNote column to items if it doesn't exist
  try {
    db.exec(`ALTER TABLE items ADD COLUMN adminNote TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Add thumbnailPath column to item_images if it doesn't exist
  try {
    db.exec(`ALTER TABLE item_images ADD COLUMN thumbnailPath TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Add quantity column to items if it doesn't exist
  try {
    db.exec(`ALTER TABLE items ADD COLUMN quantity INTEGER DEFAULT 1`);
  } catch {
    // Column already exists, ignore
  }

  // Add isVisible column to items if it doesn't exist
  try {
    db.exec(`ALTER TABLE items ADD COLUMN isVisible INTEGER DEFAULT 1`);
  } catch {
    // Column already exists, ignore
  }

  // Add price column to reservation_history if it doesn't exist
  try {
    db.exec(`ALTER TABLE reservation_history ADD COLUMN price REAL`);
  } catch {
    // Column already exists, ignore
  }

  // Add adminNote column to reservations if it doesn't exist
  try {
    db.exec(`ALTER TABLE reservations ADD COLUMN adminNote TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Add adminNote column to reservation_history if it doesn't exist
  try {
    db.exec(`ALTER TABLE reservation_history ADD COLUMN adminNote TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Add lastActivity column to users if it doesn't exist
  try {
    db.exec(`ALTER TABLE users ADD COLUMN lastActivity TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Create quantity_adjustments table for tracking quantity changes
  db.exec(`
    CREATE TABLE IF NOT EXISTS quantity_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      itemId INTEGER NOT NULL,
      oldQuantity INTEGER NOT NULL,
      newQuantity INTEGER NOT NULL,
      adjustment INTEGER NOT NULL,
      reason TEXT NOT NULL,
      adminNote TEXT,
      adjustedBy TEXT,
      adjustedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (itemId) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (adjustedBy) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_quantity_adjustments_itemId ON quantity_adjustments(itemId);
  `);

  // Migrate existing reservation_history records - fill price from current item price where missing
  db.exec(`
    UPDATE reservation_history
    SET price = (SELECT price FROM items WHERE items.id = reservation_history.itemId)
    WHERE price IS NULL
  `);

  // Create admin_orders table for bulk admin orders with discounts
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_orders (
      id TEXT PRIMARY KEY,
      itemId INTEGER NOT NULL,
      userId TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      discountType TEXT,
      discountValue REAL,
      customPrice REAL,
      originalPrice REAL,
      adminNote TEXT NOT NULL,
      createdBy TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (itemId) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id),
      FOREIGN KEY (createdBy) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_admin_orders_itemId ON admin_orders(itemId);
    CREATE INDEX IF NOT EXISTS idx_admin_orders_userId ON admin_orders(userId);
  `);

  // Add adminOrderId column to reservations
  try {
    db.exec(`ALTER TABLE reservations ADD COLUMN adminOrderId TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Add customPrice column to reservations
  try {
    db.exec(`ALTER TABLE reservations ADD COLUMN customPrice REAL`);
  } catch {
    // Column already exists, ignore
  }

  // Add adminOrderId column to reservation_history
  try {
    db.exec(`ALTER TABLE reservation_history ADD COLUMN adminOrderId TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Add customPrice column to reservation_history
  try {
    db.exec(`ALTER TABLE reservation_history ADD COLUMN customPrice REAL`);
  } catch {
    // Column already exists, ignore
  }

  console.log('Database initialized');
}

// Forward declaration for migration
function migrateExistingImages(): void {
  const items = db.prepare("SELECT id, imagePath FROM items WHERE imagePath IS NOT NULL AND imagePath != ''").all() as { id: number; imagePath: string }[];
  for (const item of items) {
    const existing = db.prepare('SELECT id FROM item_images WHERE itemId = ? AND imagePath = ?').get(item.id, item.imagePath);
    if (!existing) {
      db.prepare('INSERT INTO item_images (itemId, imagePath, sortOrder) VALUES (?, ?, 0)').run(item.id, item.imagePath);
    }
  }
}

// User operations
export function findOrCreateUser(
  id: string,
  email: string,
  displayName: string,
  isAdmin: boolean
): { id: string; email: string; displayName: string; isAdmin: boolean } {
  const existing = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(id) as { id: string; email: string; displayName: string; isAdmin: number } | undefined;

  if (existing) {
    // Update admin status if email is in admin list
    if (isAdmin && !existing.isAdmin) {
      db.prepare('UPDATE users SET isAdmin = 1 WHERE id = ?').run(id);
      existing.isAdmin = 1;
    }
    return {
      id: existing.id,
      email: existing.email,
      displayName: existing.displayName,
      isAdmin: existing.isAdmin === 1
    };
  }

  db.prepare('INSERT INTO users (id, email, displayName, isAdmin) VALUES (?, ?, ?, ?)').run(
    id,
    email,
    displayName,
    isAdmin ? 1 : 0
  );

  return { id, email, displayName, isAdmin };
}

export function getUserById(
  id: string
): { id: string; email: string; displayName: string; isAdmin: boolean } | null {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
    | { id: string; email: string; displayName: string; isAdmin: number }
    | undefined;
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isAdmin: user.isAdmin === 1
  };
}

export function getAllUsers(): { id: string; email: string; displayName: string; isAdmin: boolean; createdAt: string; lastLoginAt: string | null; lastActivity: string | null }[] {
  const users = db.prepare('SELECT * FROM users WHERE id != ? ORDER BY lastLoginAt DESC NULLS LAST, createdAt DESC').all(DELETED_USER_ID) as
    | { id: string; email: string; displayName: string; isAdmin: number; createdAt: string; lastLoginAt: string | null; lastActivity: string | null }[];
  return users.map(user => ({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isAdmin: user.isAdmin === 1,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    lastActivity: user.lastActivity
  }));
}

export function updateUserAdmin(userId: string, isAdmin: boolean): boolean {
  const result = db.prepare('UPDATE users SET isAdmin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);
  return result.changes > 0;
}

export function updateUserLastLogin(userId: string): void {
  db.prepare('UPDATE users SET lastLoginAt = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
}

export function updateUserActivity(userId: string): void {
  db.prepare('UPDATE users SET lastActivity = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
}

export function getUserLastActivity(userId: string): string | null {
  const result = db.prepare('SELECT lastActivity FROM users WHERE id = ?').get(userId) as { lastActivity: string | null } | undefined;
  return result?.lastActivity ?? null;
}

export function deleteUser(userId: string): boolean {
  if (userId === DELETED_USER_ID) return false;

  const transaction = db.transaction(() => {
    db.prepare(
      'INSERT OR IGNORE INTO users (id, email, displayName, isAdmin) VALUES (?, ?, ?, 0)'
    ).run(DELETED_USER_ID, DELETED_USER_EMAIL, DELETED_USER_DISPLAY_NAME);

    // Cancel active reservations through proper path (restore item quantity)
    const activeReservations = db.prepare('SELECT id FROM reservations WHERE userId = ?').all(userId) as { id: number }[];
    for (const r of activeReservations) {
      deleteReservation(r.id, true);
    }

    db.prepare('UPDATE reservation_history SET userId = ? WHERE userId = ?').run(DELETED_USER_ID, userId);
    db.prepare('UPDATE item_edit_history SET userId = ? WHERE userId = ?').run(DELETED_USER_ID, userId);
    db.prepare('UPDATE quantity_adjustments SET adjustedBy = NULL WHERE adjustedBy = ?').run(userId);
    db.prepare('UPDATE items SET createdBy = NULL WHERE createdBy = ?').run(userId);
    // Preserve admin_orders created by this user for other users' reservations.
    db.prepare('DELETE FROM admin_orders WHERE userId = ?').run(userId);
    db.prepare('UPDATE admin_orders SET createdBy = ? WHERE createdBy = ?').run(DELETED_USER_ID, userId);
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return result.changes > 0;
  });
  return transaction();
}

// Item operations
export interface Item {
  id: number;
  name: string;
  description: string | null;
  category: string;
  imagePath: string | null;
  price: number | null;
  status: string;
  createdAt: string;
  createdBy: string | null;
  adminNote: string | null;
  quantity: number;
  isVisible: number;
}

// Favorite operations
export interface Favorite {
  id: number;
  userId: string;
  itemId: number;
  createdAt: string;
}

export interface FavoriteWithItem extends Favorite {
  itemName: string;
  itemCategory: string;
  itemPrice: number | null;
  itemImagePath: string | null;
  itemStatus: string;
}

export function getAllAvailableItems(): Item[] {
  return db.prepare("SELECT * FROM items WHERE status = 'available' AND isVisible = 1 ORDER BY createdAt DESC").all() as Item[];
}

// Item with images interface
export interface ItemWithImages extends Item {
  images: ItemImage[];
}

// Paginated result interface
export interface PaginatedItems {
  items: ItemWithImages[];
  total: number;
  hasMore: boolean;
}

// Get all available items with images in one query (fixes N+1 problem)
// Supports pagination with limit/offset and sorting
export function getAllAvailableItemsWithImages(limit?: number, offset?: number, sort?: string, category?: string): ItemWithImages[] | PaginatedItems {
  // Get total count if pagination is requested
  let total = 0;
  if (limit !== undefined) {
    // Build WHERE clause with category filter
    let countQuery = "SELECT COUNT(*) as count FROM items WHERE status = 'available' AND isVisible = 1";
    const countParams: any[] = [];

    if (category) {
      countQuery += " AND category = ?";
      countParams.push(category);
    }

    const countResult = db.prepare(countQuery).get(...countParams) as { count: number };
    total = countResult.count;
  }

  // Determine sort order
  let orderBy = 'i.createdAt DESC'; // default: newest first
  switch (sort) {
    case 'oldest':
      orderBy = 'i.createdAt ASC';
      break;
    case 'price_asc':
      orderBy = 'i.price IS NULL, i.price ASC, i.createdAt DESC';
      break;
    case 'price_desc':
      orderBy = 'i.price IS NULL, i.price DESC, i.createdAt DESC';
      break;
    case 'newest':
    default:
      orderBy = 'i.createdAt DESC';
  }

  // Build WHERE clause with category filter
  let whereClause = "i.status = 'available' AND i.isVisible = 1";
  const queryParams: any[] = [];

  if (category) {
    whereClause += " AND i.category = ?";
    queryParams.push(category);
  }

  // Use subquery for pagination so LIMIT/OFFSET applies to items, not to item-image rows
  const paginationClause = limit !== undefined ? 'LIMIT ? OFFSET ?' : '';
  const paginationParams = limit !== undefined ? [limit, offset || 0] : [];

  const rows = db.prepare(`
    SELECT
      i.*,
      ii.id as imageId,
      ii.imagePath as imageImagePath,
      ii.thumbnailPath as imageThumbnailPath,
      ii.sortOrder as imageSortOrder,
      ii.createdAt as imageCreatedAt
    FROM (
      SELECT * FROM items i
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      ${paginationClause}
    ) i
    LEFT JOIN item_images ii ON i.id = ii.itemId
    ORDER BY ${orderBy}, ii.sortOrder ASC, ii.id ASC
  `).all(...queryParams, ...paginationParams) as any[];

  // Group images per item
  const itemsMap = new Map<number, ItemWithImages>();

  for (const row of rows) {
    if (!itemsMap.has(row.id)) {
      itemsMap.set(row.id, {
        id: row.id,
        name: row.name,
        description: row.description,
        category: row.category,
        price: row.price,
        status: row.status,
        imagePath: row.imagePath,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        adminNote: row.adminNote,
        quantity: row.quantity,
        isVisible: row.isVisible,
        images: []
      });
    }

    // Add image if exists
    if (row.imageId) {
      itemsMap.get(row.id)!.images.push({
        id: row.imageId,
        itemId: row.id,
        imagePath: row.imageImagePath,
        thumbnailPath: row.imageThumbnailPath,
        sortOrder: row.imageSortOrder,
        createdAt: row.imageCreatedAt
      });
    }
  }

  const allItems = Array.from(itemsMap.values());

  if (limit !== undefined) {
    return {
      items: allItems,
      total,
      hasMore: (offset || 0) + limit < total
    };
  }

  return allItems;
}

export function getAllItems(): Item[] {
  return db.prepare('SELECT * FROM items ORDER BY createdAt DESC').all() as Item[];
}

// Item with images, favorite count, and reservation stats for admin
export interface ItemWithImagesAndFavorites extends ItemWithImages {
  favoriteCount: number;
  reservedCount: number;
  soldCount: number;
  soldValue: number;
  buyers: string | null;
  buyerEmails: string | null;
  reservingUsers: string | null;
  reservingEmails: string | null;
  lastSoldAt: string | null;
  lastReservedAt: string | null;
}

// Get all items with images, favorite count, and reservation stats in one query (admin endpoint, fixes N+1)
export function getAllItemsWithImagesAndFavorites(): ItemWithImagesAndFavorites[] {
  const rows = db.prepare(`
    SELECT
      i.*,
      ii.id as imageId,
      ii.imagePath as imageImagePath,
      ii.thumbnailPath as imageThumbnailPath,
      ii.sortOrder as imageSortOrder,
      ii.createdAt as imageCreatedAt,
      (SELECT COUNT(*) FROM favorites WHERE itemId = i.id) as favoriteCount,
      (SELECT COUNT(*) FROM reservations WHERE itemId = i.id) as reservedCount,
      (SELECT COUNT(*) FROM reservation_history WHERE itemId = i.id AND status = 'completed') as soldCount,
      (SELECT COALESCE(SUM(price), 0) FROM reservation_history WHERE itemId = i.id AND status = 'completed') as soldValue,
      (SELECT GROUP_CONCAT(displayName, ' | ') FROM (SELECT DISTINCT u.displayName FROM reservation_history rh JOIN users u ON rh.userId = u.id WHERE rh.itemId = i.id AND rh.status = 'completed')) as buyers,
      (SELECT GROUP_CONCAT(email, ' | ') FROM (SELECT DISTINCT u.email FROM reservation_history rh JOIN users u ON rh.userId = u.id WHERE rh.itemId = i.id AND rh.status = 'completed')) as buyerEmails,
      (SELECT GROUP_CONCAT(displayName, ' | ') FROM (SELECT DISTINCT u.displayName FROM reservations r JOIN users u ON r.userId = u.id WHERE r.itemId = i.id)) as reservingUsers,
      (SELECT GROUP_CONCAT(email, ' | ') FROM (SELECT DISTINCT u.email FROM reservations r JOIN users u ON r.userId = u.id WHERE r.itemId = i.id)) as reservingEmails,
      (SELECT MAX(completedAt) FROM reservation_history WHERE itemId = i.id AND status = 'completed') as lastSoldAt,
      (SELECT MAX(createdAt) FROM reservations WHERE itemId = i.id) as lastReservedAt
    FROM items i
    LEFT JOIN item_images ii ON i.id = ii.itemId
    ORDER BY i.createdAt DESC, ii.sortOrder ASC, ii.id ASC
  `).all() as any[];

  // Group images per item
  const itemsMap = new Map<number, ItemWithImagesAndFavorites>();

  for (const row of rows) {
    if (!itemsMap.has(row.id)) {
      itemsMap.set(row.id, {
        id: row.id,
        name: row.name,
        description: row.description,
        category: row.category,
        price: row.price,
        status: row.status,
        imagePath: row.imagePath,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        adminNote: row.adminNote,
        quantity: row.quantity,
        isVisible: row.isVisible,
        images: [],
        favoriteCount: row.favoriteCount,
        reservedCount: row.reservedCount,
        soldCount: row.soldCount,
        soldValue: row.soldValue,
        buyers: row.buyers || null,
        buyerEmails: row.buyerEmails || null,
        reservingUsers: row.reservingUsers || null,
        reservingEmails: row.reservingEmails || null,
        lastSoldAt: row.lastSoldAt || null,
        lastReservedAt: row.lastReservedAt || null
      });
    }

    // Add image if exists
    if (row.imageId) {
      itemsMap.get(row.id)!.images.push({
        id: row.imageId,
        itemId: row.id,
        imagePath: row.imageImagePath,
        thumbnailPath: row.imageThumbnailPath,
        sortOrder: row.imageSortOrder,
        createdAt: row.imageCreatedAt
      });
    }
  }

  return Array.from(itemsMap.values());
}

export function getItemById(id: number): Item | null {
  return db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Item | null;
}

export interface ItemWithCreator extends Item {
  createdByEmail?: string;
  createdByDisplayName?: string;
}

export function getItemWithCreator(id: number): ItemWithCreator | null {
  return db.prepare(`
    SELECT i.*, u.email as createdByEmail, u.displayName as createdByDisplayName
    FROM items i
    LEFT JOIN users u ON i.createdBy = u.id
    WHERE i.id = ?
  `).get(id) as ItemWithCreator | null;
}

export function createItem(data: {
  name: string;
  description?: string;
  category: string;
  imagePath?: string;
  price?: number;
  createdBy?: string;
  adminNote?: string;
  quantity?: number;
  isVisible?: number;
}): Item {
  const result = db
    .prepare(
      'INSERT INTO items (name, description, category, imagePath, price, createdBy, adminNote, quantity, isVisible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(data.name, data.description || null, data.category, data.imagePath || null, data.price || null, data.createdBy || null, data.adminNote || null, data.quantity || 1, data.isVisible !== undefined ? data.isVisible : 1);

  return getItemById(result.lastInsertRowid as number)!;
}

export function updateItem(
  id: number,
  data: {
    name?: string;
    description?: string;
    category?: string;
    imagePath?: string;
    price?: number;
    status?: string;
    adminNote?: string;
    quantity?: number;
    isVisible?: number;
  }
): Item | null {
  const item = getItemById(id);
  if (!item) return null;

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (data.name !== undefined) {
    updates.push('name = ?');
    values.push(data.name);
  }
  if (data.description !== undefined) {
    updates.push('description = ?');
    values.push(data.description);
  }
  if (data.category !== undefined) {
    updates.push('category = ?');
    values.push(data.category);
  }
  if (data.imagePath !== undefined) {
    updates.push('imagePath = ?');
    values.push(data.imagePath);
  }
  if (data.price !== undefined) {
    updates.push('price = ?');
    values.push(data.price);
  }
  if (data.status !== undefined) {
    updates.push('status = ?');
    values.push(data.status);
  }
  if (data.adminNote !== undefined) {
    updates.push('adminNote = ?');
    values.push(data.adminNote);
  }
  if (data.quantity !== undefined) {
    updates.push('quantity = ?');
    values.push(data.quantity);
  }
  if (data.isVisible !== undefined) {
    updates.push('isVisible = ?');
    values.push(data.isVisible);
  }

  if (updates.length > 0) {
    values.push(id);
    db.prepare(`UPDATE items SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  return getItemById(id);
}

export function deleteItem(id: number): boolean {
  const result = db.prepare('DELETE FROM items WHERE id = ?').run(id);
  return result.changes > 0;
}

// Reservation operations
export interface Reservation {
  id: number;
  itemId: number;
  userId: string;
  status: string;
  createdAt: string;
  adminNote?: string | null;
  adminOrderId?: string | null;
  customPrice?: number | null;
  itemName?: string;
  itemCategory?: string;
  itemPrice?: number | null;
  userEmail?: string;
  userDisplayName?: string;
  // From admin_orders JOIN (for export/display)
  discountType?: string | null;
  discountValue?: number | null;
  orderAdminNote?: string | null;
}

export interface AdminOrder {
  id: string;
  itemId: number;
  userId: string;
  quantity: number;
  discountType: string | null;
  discountValue: number | null;
  customPrice: number | null;
  originalPrice: number | null;
  adminNote: string;
  createdBy: string;
  createdAt: string;
}

// Log quantity adjustment
export function logQuantityAdjustment(
  itemId: number,
  oldQuantity: number,
  newQuantity: number,
  reason: string,
  adjustedBy?: string,
  adminNote?: string
): void {
  db.prepare(
    `INSERT INTO quantity_adjustments (itemId, oldQuantity, newQuantity, adjustment, reason, adjustedBy, adminNote)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(itemId, oldQuantity, newQuantity, newQuantity - oldQuantity, reason, adjustedBy || null, adminNote || null);
}

export function createReservation(itemId: number, userId: string): Reservation | null {
  // Use transaction to prevent race conditions when multiple users reserve simultaneously
  const transaction = db.transaction(() => {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as Item | null;
    if (!item || item.status !== 'available' || item.quantity <= 0 || item.isVisible !== 1) return null;

    // Decrease quantity by 1
    const newQuantity = item.quantity - 1;
    db.prepare("UPDATE items SET quantity = ? WHERE id = ?").run(newQuantity, itemId);

    // Log quantity change
    logQuantityAdjustment(itemId, item.quantity, newQuantity, 'reservation', userId);

    // If quantity reaches 0, mark as reserved (not sold - sold is only after finalization)
    if (newQuantity === 0) {
      db.prepare("UPDATE items SET status = 'reserved' WHERE id = ?").run(itemId);
    }

    // Create reservation
    const result = db
      .prepare('INSERT INTO reservations (itemId, userId) VALUES (?, ?)')
      .run(itemId, userId);

    return getReservationById(result.lastInsertRowid as number);
  });

  return transaction();
}

export function createAdminOrder(
  itemId: number,
  userId: string,
  quantity: number,
  adminUserId: string,
  adminNote: string,
  discount?: { type: 'percent' | 'fixed'; value: number }
): { adminOrderId: string; reservations: Reservation[] } | null {
  const transaction = db.transaction(() => {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as Item | null;
    if (!item || item.status !== 'available' || item.quantity < quantity) return null;

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return null;

    // Calculate custom price — always lock the price at order time
    let customPrice: number | null = item.price;
    let discountType: string | null = null;
    let discountValue: number | null = null;

    if (discount && item.price != null) {
      discountType = discount.type;
      discountValue = discount.value;
      if (discount.type === 'percent') {
        customPrice = Math.round(item.price * (1 - discount.value / 100) * 100) / 100;
      } else {
        customPrice = Math.round((item.price - discount.value) * 100) / 100;
      }
      if (customPrice < 0) customPrice = 0;
    }

    // Create admin order record
    const adminOrderId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO admin_orders (id, itemId, userId, quantity, discountType, discountValue, customPrice, originalPrice, adminNote, createdBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(adminOrderId, itemId, userId, quantity, discountType, discountValue, customPrice, item.price, adminNote, adminUserId);

    // Decrease quantity
    const newQuantity = item.quantity - quantity;
    db.prepare("UPDATE items SET quantity = ? WHERE id = ?").run(newQuantity, itemId);
    logQuantityAdjustment(itemId, item.quantity, newQuantity, 'admin_order', adminUserId, adminNote);

    if (newQuantity === 0) {
      db.prepare("UPDATE items SET status = 'reserved' WHERE id = ?").run(itemId);
    }

    // Create N individual reservation records
    const reservations: Reservation[] = [];
    const insertStmt = db.prepare(
      `INSERT INTO reservations (itemId, userId, adminOrderId, customPrice)
       VALUES (?, ?, ?, ?)`
    );

    for (let i = 0; i < quantity; i++) {
      const result = insertStmt.run(itemId, userId, adminOrderId, customPrice);
      const reservation = getReservationById(result.lastInsertRowid as number);
      if (reservation) reservations.push(reservation);
    }

    return { adminOrderId, reservations };
  });

  return transaction();
}

export function getAdminOrderById(id: string): AdminOrder | null {
  return db.prepare('SELECT * FROM admin_orders WHERE id = ?').get(id) as AdminOrder | null;
}

export function getReservationById(id: number): Reservation | null {
  return db
    .prepare(
      `
    SELECT r.*, i.name as itemName, i.category as itemCategory, i.price as itemPrice, u.email as userEmail, u.displayName as userDisplayName
    FROM reservations r
    JOIN items i ON r.itemId = i.id
    JOIN users u ON r.userId = u.id
    WHERE r.id = ?
  `
    )
    .get(id) as Reservation | null;
}

export function getAllReservations(): Reservation[] {
  return db
    .prepare(
      `
    SELECT r.*, i.name as itemName, i.category as itemCategory, i.price as itemPrice, u.email as userEmail, u.displayName as userDisplayName,
           ao.discountType, ao.discountValue, ao.adminNote as orderAdminNote
    FROM reservations r
    JOIN items i ON r.itemId = i.id
    JOIN users u ON r.userId = u.id
    LEFT JOIN admin_orders ao ON r.adminOrderId = ao.id
    ORDER BY r.createdAt DESC
  `
    )
    .all() as Reservation[];
}

export function deleteReservation(id: number, restoreItem: boolean = true): boolean {
  const transaction = db.transaction(() => {
    const reservation = getReservationById(id);
    if (!reservation) return false;

    // Get item price at time of cancellation
    const itemForPrice = db.prepare('SELECT price FROM items WHERE id = ?').get(reservation.itemId) as { price: number | null } | null;

    // Use customPrice if set, otherwise fall back to item price
    const finalPrice = reservation.customPrice != null ? reservation.customPrice : (itemForPrice?.price ?? null);

    // Save to history as cancelled (with price, adminNote, and admin order fields)
    db.prepare(
      `INSERT INTO reservation_history (itemId, userId, status, price, createdAt, cancelledAt, adminNote, adminOrderId, customPrice)
       VALUES (?, ?, 'cancelled', ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)`
    ).run(reservation.itemId, reservation.userId, finalPrice, reservation.createdAt, reservation.adminNote || null, reservation.adminOrderId || null, reservation.customPrice ?? null);

    // Delete this reservation first
    const result = db.prepare('DELETE FROM reservations WHERE id = ?').run(id);

    if (restoreItem) {
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(reservation.itemId) as Item | null;
      if (item) {
        // Increase quantity by 1
        const newQuantity = item.quantity + 1;
        db.prepare("UPDATE items SET quantity = ? WHERE id = ?").run(newQuantity, reservation.itemId);

        // Log quantity change
        logQuantityAdjustment(reservation.itemId, item.quantity, newQuantity, 'reservation_cancelled', reservation.userId);

        // If quantity > 0, restore to available
        if (newQuantity > 0) {
          db.prepare("UPDATE items SET status = 'available' WHERE id = ?").run(reservation.itemId);
        } else {
          // quantity is still 0, check if there are other reservations
          const remaining = db.prepare(
            'SELECT COUNT(*) as count FROM reservations WHERE itemId = ?'
          ).get(reservation.itemId) as { count: number };

          if (remaining.count > 0) {
            // Other reservations exist - keep as reserved
            db.prepare("UPDATE items SET status = 'reserved' WHERE id = ?").run(reservation.itemId);
          }
          // else: no reservations and quantity=0 - leave as sold (edge case)
        }
      }
    }

    return result.changes > 0;
  });

  return transaction();
}

export function completeReservation(id: number): boolean {
  const transaction = db.transaction(() => {
    const reservation = getReservationById(id);
    if (!reservation) return false;

    // Get item price at time of sale
    const item = db.prepare('SELECT price FROM items WHERE id = ?').get(reservation.itemId) as { price: number | null } | null;

    // Use customPrice if set, otherwise fall back to item price
    const finalPrice = reservation.customPrice != null ? reservation.customPrice : (item?.price ?? null);

    // Save to history as completed (with price, adminNote, and admin order fields)
    db.prepare(
      `INSERT INTO reservation_history (itemId, userId, status, price, createdAt, completedAt, adminNote, adminOrderId, customPrice)
       VALUES (?, ?, 'completed', ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)`
    ).run(reservation.itemId, reservation.userId, finalPrice, reservation.createdAt, reservation.adminNote || null, reservation.adminOrderId || null, reservation.customPrice ?? null);

    // Delete this reservation
    db.prepare('DELETE FROM reservations WHERE id = ?').run(id);

    // Check if there are any remaining reservations for this item
    const remaining = db.prepare(
      'SELECT COUNT(*) as count FROM reservations WHERE itemId = ?'
    ).get(reservation.itemId) as { count: number };

    // If no more reservations and quantity is 0, mark as sold
    if (remaining.count === 0) {
      const item = db.prepare('SELECT quantity FROM items WHERE id = ?').get(reservation.itemId) as { quantity: number } | null;
      if (item && item.quantity === 0) {
        db.prepare("UPDATE items SET status = 'sold' WHERE id = ?").run(reservation.itemId);
      }
    }

    return true;
  });

  return transaction();
}

// Count active reservations for a user
export function getUserActiveReservationsCount(userId: string): number {
  const result = db
    .prepare('SELECT COUNT(*) as count FROM reservations WHERE userId = ?')
    .get(userId) as { count: number };
  return result.count;
}

// Update admin note on a reservation
export function updateReservationNote(id: number, adminNote: string | null): boolean {
  const result = db
    .prepare('UPDATE reservations SET adminNote = ? WHERE id = ?')
    .run(adminNote, id);
  return result.changes > 0;
}

// Image operations
export interface ItemImage {
  id: number;
  itemId: number;
  imagePath: string;
  thumbnailPath: string | null;
  sortOrder: number;
  createdAt: string;
}

export function getItemImages(itemId: number): ItemImage[] {
  return db
    .prepare('SELECT * FROM item_images WHERE itemId = ? ORDER BY sortOrder ASC, id ASC')
    .all(itemId) as ItemImage[];
}

export function addItemImage(itemId: number, imagePath: string, sortOrder: number = 0): ItemImage {
  const result = db
    .prepare('INSERT INTO item_images (itemId, imagePath, sortOrder) VALUES (?, ?, ?)')
    .run(itemId, imagePath, sortOrder);
  return db.prepare('SELECT * FROM item_images WHERE id = ?').get(result.lastInsertRowid) as ItemImage;
}

export function deleteItemImage(imageId: number): boolean {
  const result = db.prepare('DELETE FROM item_images WHERE id = ?').run(imageId);
  return result.changes > 0;
}

export function updateImageOrder(imageId: number, sortOrder: number): boolean {
  const result = db.prepare('UPDATE item_images SET sortOrder = ? WHERE id = ?').run(sortOrder, imageId);
  return result.changes > 0;
}

export function deleteAllItemImages(itemId: number): void {
  db.prepare('DELETE FROM item_images WHERE itemId = ?').run(itemId);
}

// Update thumbnail path for an image
export function updateImageThumbnail(imageId: number, thumbnailPath: string): boolean {
  const result = db.prepare('UPDATE item_images SET thumbnailPath = ? WHERE id = ?').run(thumbnailPath, imageId);
  return result.changes > 0;
}

// Get all images without thumbnails (for migration)
export function getImagesWithoutThumbnails(): ItemImage[] {
  return db.prepare('SELECT * FROM item_images WHERE thumbnailPath IS NULL').all() as ItemImage[];
}

// Get reservation history for an item (includes completed/cancelled)
export interface ReservationHistoryEntry {
  id: number;
  itemId: number;
  userId: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  userEmail: string;
  userDisplayName: string;
}

export interface ItemEditHistoryEntry {
  id: number;
  itemId: number;
  userId: string;
  changes: string;
  createdAt: string;
  userEmail: string;
  userDisplayName: string;
}

export function getItemReservationHistory(itemId: number): ReservationHistoryEntry[] {
  return db
    .prepare(
      `
    SELECT r.*, u.email as userEmail, u.displayName as userDisplayName
    FROM reservation_history r
    JOIN users u ON r.userId = u.id
    WHERE r.itemId = ?
    ORDER BY r.createdAt DESC
  `
    )
    .all(itemId) as ReservationHistoryEntry[];
}

// Get active reservations for an item
export function getActiveReservationsForItem(itemId: number): Reservation[] {
  return db
    .prepare(
      `
    SELECT r.*, u.email as userEmail, u.displayName as userDisplayName
    FROM reservations r
    JOIN users u ON r.userId = u.id
    WHERE r.itemId = ?
    ORDER BY r.createdAt DESC
  `
    )
    .all(itemId) as Reservation[];
}

// Favorites operations
export function addFavorite(userId: string, itemId: number): Favorite | null {
  try {
    const item = db.prepare('SELECT isVisible FROM items WHERE id = ?').get(itemId) as { isVisible: number } | undefined;
    if (!item || item.isVisible !== 1) return null;

    const result = db
      .prepare('INSERT INTO favorites (userId, itemId) VALUES (?, ?)')
      .run(userId, itemId);
    return db.prepare('SELECT * FROM favorites WHERE id = ?').get(result.lastInsertRowid) as Favorite;
  } catch (error) {
    return null; // Duplicate entry
  }
}

export function removeFavorite(userId: string, itemId: number): boolean {
  const result = db
    .prepare('DELETE FROM favorites WHERE userId = ? AND itemId = ?')
    .run(userId, itemId);
  return result.changes > 0;
}

export function getUserFavorites(userId: string): FavoriteWithItem[] {
  return db
    .prepare(
      `
    SELECT
      f.*,
      i.name as itemName,
      i.category as itemCategory,
      i.price as itemPrice,
      i.imagePath as itemImagePath,
      i.status as itemStatus
    FROM favorites f
    JOIN items i ON f.itemId = i.id
    WHERE f.userId = ? AND i.isVisible = 1
    ORDER BY f.createdAt DESC
  `
    )
    .all(userId) as FavoriteWithItem[];
}

export function isFavorite(userId: string, itemId: number): boolean {
  const result = db
    .prepare('SELECT id FROM favorites WHERE userId = ? AND itemId = ?')
    .get(userId, itemId);
  return result !== undefined;
}

export function getUserFavoriteIds(userId: string): number[] {
  const favorites = db
    .prepare(`
      SELECT f.itemId
      FROM favorites f
      JOIN items i ON f.itemId = i.id
      WHERE f.userId = ? AND i.isVisible = 1
    `)
    .all(userId) as { itemId: number }[];
  return favorites.map(f => f.itemId);
}

export function getFavoriteCount(itemId: number): number {
  const result = db
    .prepare('SELECT COUNT(*) as count FROM favorites WHERE itemId = ?')
    .get(itemId) as { count: number };
  return result.count;
}

// Favorite history operations
export interface FavoriteHistoryEntry {
  id: number;
  userId: string;
  itemId: number;
  action: string;
  createdAt: string;
  userEmail?: string;
  userDisplayName?: string;
  itemName?: string;
  itemCategory?: string;
}

export function logFavoriteAction(userId: string, itemId: number, action: 'add' | 'remove'): void {
  db.prepare('INSERT INTO favorite_history (userId, itemId, action) VALUES (?, ?, ?)')
    .run(userId, itemId, action);
}

export function getFavoriteHistory(limit: number = 50, offset: number = 0): FavoriteHistoryEntry[] {
  return db
    .prepare(`
      SELECT
        fh.*,
        u.email as userEmail,
        u.displayName as userDisplayName,
        i.name as itemName,
        i.category as itemCategory
      FROM favorite_history fh
      JOIN users u ON fh.userId = u.id
      LEFT JOIN items i ON fh.itemId = i.id
      ORDER BY fh.createdAt DESC
      LIMIT ? OFFSET ?
    `)
    .all(limit, offset) as FavoriteHistoryEntry[];
}

// Item edit history operations
export function logItemEdit(
  itemId: number,
  userId: string,
  changes: Record<string, unknown>
): void {
  const changesJson = JSON.stringify(changes);
  db.prepare('INSERT INTO item_edit_history (itemId, userId, changes) VALUES (?, ?, ?)')
    .run(itemId, userId, changesJson);
}

export function getItemEditHistory(itemId: number): ItemEditHistoryEntry[] {
  return db
    .prepare(`
      SELECT
        eh.*,
        u.email as userEmail,
        u.displayName as userDisplayName
      FROM item_edit_history eh
      JOIN users u ON eh.userId = u.id
      WHERE eh.itemId = ?
      ORDER BY eh.createdAt DESC
    `)
    .all(itemId) as ItemEditHistoryEntry[];
}
