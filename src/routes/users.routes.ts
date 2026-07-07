import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/auth.middleware';
import { getAllUsers, updateUserAdmin, deleteUser, getUserById } from '../db';
import { logger, getRequestInfo } from '../logger';
import { sendAdminRightsNotification } from '../email';

const router = Router();

// Get all users (admin only)
router.get('/', requireAdmin, (req: Request, res: Response) => {
  const users = getAllUsers();
  res.json(users);
});

// Update user admin status (admin only)
router.put('/:id/admin', requireAdmin, async (req: Request, res: Response) => {
  const userId = String(req.params.id);
  const { isAdmin } = req.body;

  if (typeof isAdmin !== 'boolean') {
    res.status(400).json({ error: 'isAdmin must be a boolean' });
    return;
  }

  // Prevent removing your own admin rights
  if (userId === req.user!.id && !isAdmin) {
    res.status(400).json({ error: 'Cannot remove your own admin rights' });
    return;
  }

  // Get target user info before update
  const targetUser = getUserById(userId);
  if (!targetUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const updated = updateUserAdmin(userId, isAdmin);
  if (!updated) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  logger.action(isAdmin ? 'Admin rights granted' : 'Admin rights removed', {
    ...getRequestInfo(req),
    action: isAdmin ? 'ADMIN_GRANT' : 'ADMIN_REVOKE',
    details: { targetUserId: userId }
  });

  // Send email notification to the user
  await sendAdminRightsNotification(
    { email: targetUser.email, displayName: targetUser.displayName },
    isAdmin,
    { displayName: req.user!.displayName, email: req.user!.email }
  );

  res.json({ success: true });
});

// Delete user (admin only)
router.delete('/:id', requireAdmin, (req: Request, res: Response) => {
  const userId = String(req.params.id);

  // Prevent deleting yourself
  if (userId === req.user!.id) {
    res.status(400).json({ error: 'Cannot delete your own account' });
    return;
  }

  try {
    const deleted = deleteUser(userId);
    if (!deleted) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    logger.action('User account deleted', {
      ...getRequestInfo(req),
      action: 'USER_DELETE',
      details: { targetUserId: userId }
    });

    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to delete user', {
      ...getRequestInfo(req),
      action: 'USER_DELETE_FAILED',
      details: { targetUserId: userId, error: String(err) }
    });
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
