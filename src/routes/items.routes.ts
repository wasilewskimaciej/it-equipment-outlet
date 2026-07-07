import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth, requireAdmin } from '../middleware/auth.middleware';
import {
  getAllAvailableItemsWithImages,
  getAllItemsWithImagesAndFavorites,
  getItemById,
  getItemWithCreator,
  createItem,
  updateItem,
  deleteItem,
  getItemImages,
  addItemImage,
  deleteItemImage,
  updateImageOrder,
  getItemReservationHistory,
  getActiveReservationsForItem,
  getFavoriteCount,
  logItemEdit,
  getItemEditHistory,
  updateImageThumbnail,
  logQuantityAdjustment,
  PaginatedItems,
  ItemWithImages
} from '../db';
import { config } from '../config';
import { logger, getRequestInfo } from '../logger';
import { generateThumbnail, deleteThumbnail } from '../services/thumbnail';

const router = Router();

// Dozwolone kategorie — whitelista walidowana przy zapisie. Chroni przed
// zapisaniem dowolnego (potencjalnie złośliwego) ciągu w polu category,
// które front renderuje jako etykietę.
const ALLOWED_CATEGORIES = new Set(['phone', 'desktop', 'laptop', 'monitor', 'other']);

// Helper: usuń pliki przesłane przez multer (po nieudanej walidacji)
function cleanupUploadedFiles(req: Request): void {
  const single = req.file;
  if (single) { try { fs.unlinkSync(single.path); } catch {} }
  const many = req.files as Express.Multer.File[] | undefined;
  if (many) many.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
}

// Configure multer for image upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(config.paths.uploads)) {
      fs.mkdirSync(config.paths.uploads, { recursive: true });
    }
    cb(null, config.paths.uploads);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'item-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Validate file magic bytes
function validateImageMagicBytes(filePath: string): boolean {
  try {
    const buffer = Buffer.alloc(12);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 12, 0);
    fs.closeSync(fd);

    // Check JPEG
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return true;
    // Check PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return true;
    // Check GIF
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return true;
    // Check WebP (RIFF....WEBP)
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return true;

    return false;
  } catch {
    return false;
  }
}

// Delete invalid uploaded files
function cleanupInvalidFiles(files: Express.Multer.File[]): Express.Multer.File[] {
  const validFiles: Express.Multer.File[] = [];
  for (const file of files) {
    if (validateImageMagicBytes(file.path)) {
      validFiles.push(file);
    } else {
      // Delete invalid file
      try {
        fs.unlinkSync(file.path);
        logger.warn('Rejected file with invalid magic bytes', {
          action: 'INVALID_FILE_REJECTED',
          details: { filename: file.originalname, mimetype: file.mimetype }
        });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
  return validFiles;
}

// Helper function to get item with images
function getItemWithImages(id: number) {
  const item = getItemById(id);
  if (!item) return null;
  const images = getItemImages(id);
  return { ...item, images };
}

// Get all available items (for regular users)
// Uses JOIN query to fetch items with images in 1 query (fixes N+1 problem)
// Supports pagination with ?limit=15&offset=0 and sorting with ?sort=newest
router.get('/', requireAuth, (req: Request, res: Response) => {
  const limitParam = req.query.limit;
  const offsetParam = req.query.offset;
  const sortParam = String(req.query.sort || 'newest');
  const categoryParam = req.query.category ? String(req.query.category) : undefined;

  // If pagination params provided, return paginated result
  if (limitParam !== undefined) {
    const limit = Math.min(parseInt(String(limitParam), 10) || 15, 50); // Max 50
    const offset = parseInt(String(offsetParam), 10) || 0;
    const result = getAllAvailableItemsWithImages(limit, offset, sortParam, categoryParam) as PaginatedItems;

    // Strip adminNote from items for non-admin users (security)
    result.items = result.items.map(item => {
      const { adminNote, ...publicItem } = item;
      return publicItem as ItemWithImages;
    });

    res.json(result);
    return;
  }

  // No pagination - return all items (backwards compatible)
  const items = getAllAvailableItemsWithImages(undefined, undefined, sortParam, categoryParam) as ItemWithImages[];

  // Strip adminNote from items for non-admin users (security)
  const publicItems = items.map(item => {
    const { adminNote, ...publicItem } = item;
    return publicItem as ItemWithImages;
  });

  res.json(publicItems);
});

// Get all items including reserved/sold (admin only)
// Uses JOIN query to fetch items with images and favorites in 1 query (fixes N+1 problem)
router.get('/all', requireAdmin, (req: Request, res: Response) => {
  const items = getAllItemsWithImagesAndFavorites();
  res.json(items);
});

// Get single item with all images
router.get('/:id', requireAuth, (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const item = getItemWithCreator(id);
  if (!item) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }

  // Non-admin users can only see visible and available items
  if (!req.user?.isAdmin && (item.isVisible === 0 || item.status !== 'available')) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }

  const images = getItemImages(id);

  // Strip admin-only fields for non-admin users
  if (!req.user?.isAdmin) {
    const { adminNote, createdBy, createdByEmail, createdByDisplayName, ...publicItem } = item;
    res.json({ ...publicItem, images });
    return;
  }

  res.json({ ...item, images });
});

// Create item (admin only) - supports multiple images
router.post('/', requireAdmin, upload.array('images', 10), (req: Request, res: Response) => {
  const { name, description, category, price, adminNote, quantity, isVisible } = req.body;

  if (!name || !category) {
    cleanupUploadedFiles(req);
    res.status(400).json({ error: 'Name and category are required' });
    return;
  }

  if (!ALLOWED_CATEGORIES.has(category)) {
    cleanupUploadedFiles(req);
    res.status(400).json({ error: 'Invalid category' });
    return;
  }

  const parsedQuantity = quantity != null && quantity !== '' ? parseInt(quantity, 10) : undefined;
  if (parsedQuantity !== undefined && (isNaN(parsedQuantity) || parsedQuantity < 0)) {
    cleanupUploadedFiles(req);
    res.status(400).json({ error: 'Quantity must be a non-negative number' });
    return;
  }

  // Validate magic bytes and filter out invalid files
  const rawFiles = req.files as Express.Multer.File[];
  const files = rawFiles ? cleanupInvalidFiles(rawFiles) : [];
  const firstImagePath = files && files.length > 0 ? `/images/${files[0].filename}` : undefined;

  const item = createItem({
    name,
    description,
    category,
    imagePath: firstImagePath,
    price: price != null && price !== '' ? parseFloat(price) : undefined,
    createdBy: (req as any).user?.id,
    adminNote: adminNote || undefined,
    quantity: parsedQuantity,
    isVisible: isVisible != null && isVisible !== '' ? parseInt(isVisible, 10) : 1
  });

  // Add all images to item_images table and generate thumbnails
  if (files && files.length > 0) {
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const imagePath = `/images/${file.filename}`;
      const image = addItemImage(item.id, imagePath, index);

      // Generate thumbnail asynchronously (don't block response)
      generateThumbnail(imagePath)
        .then(thumbPath => {
          updateImageThumbnail(image.id, thumbPath);
        })
        .catch(err => {
          logger.warn('Thumbnail generation failed', {
            action: 'THUMBNAIL_FAILED',
            details: { imageId: image.id, error: err.message }
          });
        });
    }
  }

  logger.action('Item created', {
    ...getRequestInfo(req),
    action: 'ITEM_CREATE',
    details: {
      itemId: item.id,
      name: item.name,
      category: item.category,
      price: item.price,
      imageCount: files?.length || 0
    }
  });

  const itemWithImages = getItemWithImages(item.id);
  res.status(201).json(itemWithImages);
});

// Update item (admin only)
router.put('/:id', requireAdmin, upload.single('image'), (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const { name, description, category, price, status, adminNote, quantity, isVisible } = req.body;

  const updateData: {
    name?: string;
    description?: string;
    category?: string;
    imagePath?: string;
    price?: number;
    status?: string;
    adminNote?: string;
    quantity?: number;
    isVisible?: number;
  } = {};

  if (category !== undefined && category !== '' && !ALLOWED_CATEGORIES.has(category)) {
    cleanupUploadedFiles(req);
    res.status(400).json({ error: 'Invalid category' });
    return;
  }

  if (name) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (category) updateData.category = category;
  if (price !== undefined) updateData.price = price != null && price !== '' ? parseFloat(price) : undefined;
  if (status) updateData.status = status;
  if (adminNote !== undefined) updateData.adminNote = adminNote;
  if (quantity !== undefined) {
    const parsedQuantity = quantity != null && quantity !== '' ? parseInt(quantity, 10) : undefined;
    if (parsedQuantity !== undefined && (isNaN(parsedQuantity) || parsedQuantity < 0)) {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
      res.status(400).json({ error: 'Quantity must be a non-negative number' });
      return;
    }
    updateData.quantity = parsedQuantity;
  }
  if (isVisible !== undefined) updateData.isVisible = isVisible != null && isVisible !== '' ? parseInt(isVisible, 10) : undefined;
  if (req.file) {
    if (!validateImageMagicBytes(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch {}
      res.status(400).json({ error: 'Invalid image file' });
      return;
    }
    updateData.imagePath = `/images/${req.file.filename}`;
  }

  // Get current item before update to track quantity changes
  const currentItem = getItemById(id);
  if (!currentItem) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }

  const item = updateItem(id, updateData);
  if (!item) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }

  // Log quantity change if quantity was modified
  if (updateData.quantity !== undefined && updateData.quantity !== currentItem.quantity) {
    logQuantityAdjustment(
      id,
      currentItem.quantity,
      updateData.quantity,
      'manual',
      req.user?.id
    );

    // Auto-hide item when quantity reaches 0 and no active reservations
    if (updateData.quantity === 0) {
      updateItem(id, { isVisible: 0 });
    }
  }

  // Log edit to history
  if (req.user) {
    logItemEdit(id, req.user.id, updateData);
  }

  logger.action('Item updated', {
    ...getRequestInfo(req),
    action: 'ITEM_UPDATE',
    details: {
      itemId: id,
      name: item.name,
      changes: updateData
    }
  });

  res.json(item);
});

// Delete item (admin only)
router.delete('/:id', requireAdmin, (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);

  // Get item and all images to delete files
  const item = getItemById(id);
  const images = getItemImages(id);

  // Delete all image files and thumbnails
  for (const img of images) {
    const imagePath = path.join(config.paths.uploads, path.basename(img.imagePath));
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
    // Delete thumbnail if exists
    if (img.thumbnailPath) {
      deleteThumbnail(img.thumbnailPath);
    }
  }

  // Also delete legacy imagePath if exists and not in images table
  if (item?.imagePath) {
    const legacyPath = path.join(config.paths.uploads, path.basename(item.imagePath));
    if (fs.existsSync(legacyPath)) {
      fs.unlinkSync(legacyPath);
    }
  }

  const deleted = deleteItem(id);
  if (!deleted) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }

  logger.action('Item deleted', {
    ...getRequestInfo(req),
    action: 'ITEM_DELETE',
    details: {
      itemId: id,
      name: item?.name,
      category: item?.category,
      imageCount: images.length
    }
  });

  res.json({ success: true });
});

// === Image management endpoints ===

// Add images to existing item
router.post('/:id/images', requireAdmin, upload.array('images', 10), (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const item = getItemById(id);

  if (!item) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }

  // Validate magic bytes and filter out invalid files
  const rawFiles = req.files as Express.Multer.File[];
  const files = rawFiles ? cleanupInvalidFiles(rawFiles) : [];
  if (files.length === 0) {
    res.status(400).json({ error: 'No valid images provided' });
    return;
  }

  // Get current max sortOrder
  const existingImages = getItemImages(id);
  const maxOrder = existingImages.length > 0 ? Math.max(...existingImages.map((i) => i.sortOrder)) : -1;

  // Add new images and generate thumbnails
  const newImages = files.map((file, index) => {
    const imagePath = `/images/${file.filename}`;
    const image = addItemImage(id, imagePath, maxOrder + 1 + index);

    // Generate thumbnail asynchronously
    generateThumbnail(imagePath)
      .then(thumbPath => {
        updateImageThumbnail(image.id, thumbPath);
      })
      .catch(err => {
        logger.warn('Thumbnail generation failed', {
          action: 'THUMBNAIL_FAILED',
          details: { imageId: image.id, error: err.message }
        });
      });

    return image;
  });

  // Update item's imagePath to first image if it was empty
  if (!item.imagePath && newImages.length > 0) {
    updateItem(id, { imagePath: newImages[0].imagePath });
  }

  logger.action('Images added to item', {
    ...getRequestInfo(req),
    action: 'ITEM_IMAGES_ADD',
    details: { itemId: id, addedCount: newImages.length }
  });

  res.json(getItemWithImages(id));
});

// Delete single image from item
router.delete('/:id/images/:imageId', requireAdmin, (req: Request, res: Response) => {
  const itemId = parseInt(String(req.params.id), 10);
  const imageId = parseInt(String(req.params.imageId), 10);

  const item = getItemById(itemId);
  if (!item) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }

  const images = getItemImages(itemId);
  const imageToDelete = images.find((img) => img.id === imageId);

  if (!imageToDelete) {
    res.status(404).json({ error: 'Image not found' });
    return;
  }

  // Delete original file
  const imagePath = path.join(config.paths.uploads, path.basename(imageToDelete.imagePath));
  if (fs.existsSync(imagePath)) {
    fs.unlinkSync(imagePath);
  }

  // Delete thumbnail if exists
  if (imageToDelete.thumbnailPath) {
    deleteThumbnail(imageToDelete.thumbnailPath);
  }

  deleteItemImage(imageId);

  // Update item's imagePath if deleted image was the main one
  if (item.imagePath === imageToDelete.imagePath) {
    const remainingImages = getItemImages(itemId);
    const newMainImage = remainingImages.length > 0 ? remainingImages[0].imagePath : null;
    updateItem(itemId, { imagePath: newMainImage || '' });
  }

  logger.action('Image deleted from item', {
    ...getRequestInfo(req),
    action: 'ITEM_IMAGE_DELETE',
    details: { itemId, imageId, imagePath: imageToDelete.imagePath }
  });

  res.json(getItemWithImages(itemId));
});

// Reorder images
router.put('/:id/images/order', requireAdmin, (req: Request, res: Response) => {
  const itemId = parseInt(String(req.params.id), 10);
  const { imageOrder } = req.body; // Array of { id, sortOrder }

  const item = getItemById(itemId);
  if (!item) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }

  if (!Array.isArray(imageOrder)) {
    res.status(400).json({ error: 'imageOrder must be an array' });
    return;
  }

  // Update order for each image
  for (const { id, sortOrder } of imageOrder) {
    updateImageOrder(id, sortOrder);
  }

  // Update item's imagePath to first image (lowest sortOrder)
  const sortedImages = getItemImages(itemId);
  if (sortedImages.length > 0) {
    updateItem(itemId, { imagePath: sortedImages[0].imagePath });
  }

  logger.action('Image order updated', {
    ...getRequestInfo(req),
    action: 'ITEM_IMAGES_REORDER',
    details: { itemId }
  });

  res.json(getItemWithImages(itemId));
});

// Get reservation history for an item (admin only)
router.get('/:id/history', requireAdmin, (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const item = getItemById(id);

  if (!item) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }

  const history = getItemReservationHistory(id);
  const activeReservations = getActiveReservationsForItem(id);
  const editHistory = getItemEditHistory(id);

  // Combine history, active reservations, and edit history
  res.json({ history, activeReservations, editHistory });
});

// Get favorite count for an item
router.get('/:id/favorites/count', requireAuth, (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const item = getItemById(id);

  if (!item) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }

  const count = getFavoriteCount(id);
  res.json({ count });
});

export default router;
