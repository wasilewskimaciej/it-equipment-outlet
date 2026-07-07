import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import {
  addFavorite,
  removeFavorite,
  getUserFavorites,
  getUserFavoriteIds,
  logFavoriteAction,
  getFavoriteHistory
} from '../db';
import { requireAdmin } from '../middleware/auth.middleware';
import { logger, getRequestInfo } from '../logger';

const router = Router();

// GET /api/favorites/my - Pobierz ulubione użytkownika
router.get('/my', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.id;
  const favorites = getUserFavorites(userId);
  res.json(favorites);
});

// GET /api/favorites/my/ids - Pobierz ID-ki ulubionych (quick check)
router.get('/my/ids', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.id;
  const ids = getUserFavoriteIds(userId);
  res.json(ids);
});

// POST /api/favorites - Dodaj do ulubionych
router.post('/', requireAuth, (req: Request, res: Response) => {
  const { itemId } = req.body;

  if (!itemId) {
    res.status(400).json({ error: 'itemId is required' });
    return;
  }

  const userId = req.user!.id;
  const parsedItemId = parseInt(itemId, 10);
  const favorite = addFavorite(userId, parsedItemId);

  if (!favorite) {
    res.status(400).json({ error: 'Nie można dodać do ulubionych' });
    return;
  }

  // Log to history
  logFavoriteAction(userId, parsedItemId, 'add');

  logger.action('Item favorited', {
    ...getRequestInfo(req),
    action: 'FAVORITE_ADD',
    details: { itemId, userId }
  });

  res.status(201).json(favorite);
});

// DELETE /api/favorites/:itemId - Usuń z ulubionych
router.delete('/:itemId', requireAuth, (req: Request, res: Response) => {
  const itemId = parseInt(String(req.params.itemId), 10);
  const userId = req.user!.id;

  const removed = removeFavorite(userId, itemId);

  if (!removed) {
    res.status(404).json({ error: 'Favorite not found' });
    return;
  }

  // Log to history
  logFavoriteAction(userId, itemId, 'remove');

  logger.action('Item unfavorited', {
    ...getRequestInfo(req),
    action: 'FAVORITE_REMOVE',
    details: { itemId, userId }
  });

  res.json({ success: true });
});

// GET /api/favorites/history - Pobierz historię ulubionych (admin only)
router.get('/history', requireAdmin, (req: Request, res: Response) => {
  const limit = parseInt(String(req.query.limit || '50'), 10);
  const offset = parseInt(String(req.query.offset || '0'), 10);
  const history = getFavoriteHistory(limit, offset);
  res.json(history);
});

export default router;
