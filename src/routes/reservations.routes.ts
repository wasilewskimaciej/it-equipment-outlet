import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.middleware';
import {
  createReservation,
  createAdminOrder,
  getAllReservations,
  deleteReservation,
  completeReservation,
  getReservationById,
  getItemById,
  getUserActiveReservationsCount,
  getUserById,
  updateReservationNote,
  Reservation
} from '../db';
import { sendReservationNotification, sendCancellationNotification, sendAdminOrderNotification } from '../email';
import { logger, getRequestInfo } from '../logger';
import * as XLSX from 'xlsx';

// Maximum active reservations per user
const MAX_ACTIVE_RESERVATIONS = 3;

const router = Router();

// Create reservation (any authenticated user)
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const { itemId } = req.body;

  if (!itemId) {
    res.status(400).json({ error: 'itemId is required' });
    return;
  }

  const userId = req.user!.id;

  // Check if user has reached the maximum number of active reservations
  const activeCount = getUserActiveReservationsCount(userId);
  if (activeCount >= MAX_ACTIVE_RESERVATIONS) {
    logger.warn('User exceeded max reservations limit', {
      ...getRequestInfo(req),
      action: 'RESERVATION_LIMIT_EXCEEDED',
      details: { activeCount, maxAllowed: MAX_ACTIVE_RESERVATIONS }
    });
    res.status(400).json({
      error: `Osiągnięto limit ${MAX_ACTIVE_RESERVATIONS} aktywnych rezerwacji. Anuluj jedną z istniejących rezerwacji, aby móc zarezerwować nowy przedmiot.`
    });
    return;
  }

  const reservation = createReservation(parseInt(itemId, 10), userId);

  if (!reservation) {
    logger.warn('Reservation failed - item not available', {
      ...getRequestInfo(req),
      action: 'RESERVATION_FAILED',
      details: { itemId }
    });
    res.status(400).json({ error: 'Ten przedmiot nie jest już dostępny. Odśwież stronę, aby zobaczyć aktualną listę.' });
    return;
  }

  logger.action('Reservation created', {
    ...getRequestInfo(req),
    action: 'RESERVATION_CREATE',
    details: {
      reservationId: reservation.id,
      itemId: reservation.itemId,
      itemName: reservation.itemName
    }
  });

  // Send notification email to admin
  const emailSent = await sendReservationNotification(reservation);

  // Remove admin-only fields from response
  const { adminNote, orderAdminNote, discountType, discountValue, ...publicReservation } = reservation;
  res.status(201).json({ ...publicReservation, emailSent });
});

// Get my reservations (current user)
router.get('/my', requireAuth, (req: Request, res: Response) => {
  const reservations = getAllReservations()
    .filter((r) => r.userId === req.user!.id)
    .map(({ adminNote, orderAdminNote, discountType, discountValue, ...rest }) => rest); // Remove admin-only fields
  res.json(reservations);
});

// Get all reservations (admin only)
router.get('/', requireAdmin, (req: Request, res: Response) => {
  const reservations = getAllReservations();
  res.json(reservations);
});

// Admin manual order - bulk reservation with discount, bypasses user limits
router.post('/admin-order', requireAdmin, async (req: Request, res: Response) => {
  const { itemId, userId, quantity, adminNote, discountType, discountValue } = req.body;

  if (!itemId || !userId) {
    res.status(400).json({ error: 'itemId i userId są wymagane' });
    return;
  }

  if (!adminNote || typeof adminNote !== 'string' || !adminNote.trim()) {
    res.status(400).json({ error: 'Notatka admina jest wymagana' });
    return;
  }

  const qty = quantity != null ? parseInt(quantity, 10) : 1;
  if (isNaN(qty) || qty < 1) {
    res.status(400).json({ error: 'Ilość musi być co najmniej 1' });
    return;
  }

  // Validate discount if provided
  let discount: { type: 'percent' | 'fixed'; value: number } | undefined;
  if (discountType && discountValue != null && discountValue !== '') {
    if (discountType !== 'percent' && discountType !== 'fixed') {
      res.status(400).json({ error: 'Typ rabatu musi być "percent" lub "fixed"' });
      return;
    }
    const dv = parseFloat(discountValue);
    if (isNaN(dv) || dv < 0) {
      res.status(400).json({ error: 'Wartość rabatu musi być >= 0' });
      return;
    }
    if (discountType === 'percent' && dv > 100) {
      res.status(400).json({ error: 'Rabat procentowy nie może przekroczyć 100%' });
      return;
    }
    if (discountType === 'fixed') {
      const item = getItemById(parseInt(itemId, 10));
      if (item && item.price != null && dv > item.price) {
        res.status(400).json({ error: 'Rabat stały nie może przekroczyć ceny przedmiotu' });
        return;
      }
    }
    discount = { type: discountType, value: dv };
  }

  // Verify user exists
  const targetUser = getUserById(userId);
  if (!targetUser) {
    res.status(400).json({ error: 'Użytkownik nie istnieje' });
    return;
  }

  const result = createAdminOrder(
    parseInt(itemId, 10),
    userId,
    qty,
    req.user!.id,
    adminNote.trim(),
    discount
  );

  if (!result) {
    res.status(400).json({
      error: 'Nie udało się utworzyć zamówienia. Sprawdź czy przedmiot jest dostępny i ma wystarczającą ilość.'
    });
    return;
  }

  logger.action('Admin created manual order', {
    ...getRequestInfo(req),
    action: 'ADMIN_MANUAL_ORDER',
    details: {
      adminOrderId: result.adminOrderId,
      reservationIds: result.reservations.map(r => r.id),
      itemId,
      userId,
      quantity: qty,
      discount: discount || null,
      targetUser: targetUser.email
    }
  });

  // Send admin order notification email
  let emailSent = false;
  const firstRes = result.reservations[0];
  if (firstRes) {
    emailSent = await sendAdminOrderNotification(
      firstRes.itemName || '',
      firstRes.itemCategory || 'other',
      qty,
      { displayName: targetUser.displayName, email: targetUser.email },
      { displayName: req.user!.displayName, email: req.user!.email },
      discount || null,
      firstRes.customPrice ?? null,
      firstRes.itemPrice ?? null,
      adminNote.trim()
    );
  }

  res.status(201).json({
    success: true,
    adminOrderId: result.adminOrderId,
    count: result.reservations.length,
    reservations: result.reservations,
    emailSent
  });
});

// Get single reservation
router.get('/:id', requireAdmin, (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const reservation = getReservationById(id);
  if (!reservation) {
    res.status(404).json({ error: 'Reservation not found' });
    return;
  }
  res.json(reservation);
});

// Cancel own reservation (user can cancel their own)
router.delete('/my/:id', requireAuth, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const reservation = getReservationById(id);

  if (!reservation) {
    res.status(404).json({ error: 'Reservation not found' });
    return;
  }

  // Check if user owns this reservation
  if (reservation.userId !== req.user!.id) {
    logger.warn('Unauthorized reservation cancel attempt', {
      ...getRequestInfo(req),
      action: 'RESERVATION_CANCEL_UNAUTHORIZED',
      details: { reservationId: id, ownerId: reservation.userId }
    });
    res.status(403).json({ error: 'You can only cancel your own reservations' });
    return;
  }

  const deleted = deleteReservation(id, true);
  if (!deleted) {
    res.status(404).json({ error: 'Reservation not found' });
    return;
  }

  logger.action('User cancelled own reservation', {
    ...getRequestInfo(req),
    action: 'RESERVATION_CANCEL_SELF',
    details: {
      reservationId: id,
      itemId: reservation.itemId,
      itemName: reservation.itemName
    }
  });

  // Send cancellation notification
  const emailSent = await sendCancellationNotification(reservation, {
    displayName: req.user!.displayName,
    email: req.user!.email,
    isAdmin: req.user!.isAdmin
  });

  res.json({ success: true, emailSent });
});

// Cancel reservation - restore item to available (admin only)
router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const reservation = getReservationById(id);

  if (!reservation) {
    res.status(404).json({ error: 'Reservation not found' });
    return;
  }

  const deleted = deleteReservation(id, true);

  if (!deleted) {
    res.status(404).json({ error: 'Reservation not found' });
    return;
  }

  logger.action('Admin cancelled reservation', {
    ...getRequestInfo(req),
    action: 'RESERVATION_CANCEL_ADMIN',
    details: {
      reservationId: id,
      itemId: reservation.itemId,
      itemName: reservation.itemName,
      reservedBy: reservation.userEmail
    }
  });

  // Send cancellation notification
  const emailSent = await sendCancellationNotification(reservation, {
    displayName: req.user!.displayName,
    email: req.user!.email,
    isAdmin: req.user!.isAdmin
  });

  res.json({ success: true, emailSent });
});

// Complete reservation - mark item as sold (admin only)
router.post('/:id/complete', requireAdmin, (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const reservation = getReservationById(id);
  const completed = completeReservation(id);

  if (!completed) {
    res.status(404).json({ error: 'Reservation not found' });
    return;
  }

  logger.action('Reservation completed - item sold', {
    ...getRequestInfo(req),
    action: 'RESERVATION_COMPLETE',
    details: {
      reservationId: id,
      itemId: reservation?.itemId,
      itemName: reservation?.itemName,
      soldTo: reservation?.userEmail
    }
  });

  res.json({ success: true });
});

// Update reservation admin note (admin only)
router.put('/:id/note', requireAdmin, (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const { adminNote } = req.body;

  if (adminNote !== undefined && adminNote !== null && typeof adminNote !== 'string') {
    res.status(400).json({ error: 'adminNote must be a string or null' });
    return;
  }

  const reservation = getReservationById(id);
  if (!reservation) {
    res.status(404).json({ error: 'Reservation not found' });
    return;
  }

  const noteValue = adminNote && adminNote.trim() ? adminNote.trim() : null;
  const updated = updateReservationNote(id, noteValue);

  if (!updated) {
    res.status(500).json({ error: 'Failed to update note' });
    return;
  }

  logger.action('Reservation note updated', {
    ...getRequestInfo(req),
    action: 'RESERVATION_NOTE_UPDATE',
    details: {
      reservationId: id,
      itemName: reservation.itemName
    }
  });

  res.json({ success: true, adminNote: noteValue });
});

// Helper: Format date for Polish timezone
function formatPolishDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString('pl-PL', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Helper: Get category label in Polish
function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    phone: 'Telefon',
    desktop: 'Komputer stacjonarny',
    laptop: 'Laptop',
    monitor: 'Monitor',
    other: 'Inne'
  };
  return labels[category] || category;
}

// Helper: Get status label in Polish
function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Oczekująca',
    completed: 'Zrealizowana',
    cancelled: 'Anulowana'
  };
  return labels[status] || status;
}

// Export reservations to Excel (admin only)
router.get('/export/excel', requireAdmin, (req: Request, res: Response) => {
  const sortBy = String(req.query.sort || 'date');
  const order = String(req.query.order || 'desc');
  const statusFilter = String(req.query.status || 'pending');

  let reservations = getAllReservations();

  // Filter by status
  if (statusFilter !== 'all') {
    reservations = reservations.filter(r => r.status === statusFilter);
  }

  // Sort reservations
  reservations.sort((a: Reservation, b: Reservation) => {
    let comparison = 0;

    switch (sortBy) {
      case 'date':
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      case 'user':
        comparison = (a.userDisplayName || '').localeCompare(b.userDisplayName || '', 'pl');
        break;
      case 'item':
        comparison = (a.itemName || '').localeCompare(b.itemName || '', 'pl');
        break;
      case 'category':
        comparison = (a.itemCategory || '').localeCompare(b.itemCategory || '', 'pl');
        break;
      default:
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }

    return order === 'desc' ? -comparison : comparison;
  });

  // Transform data for Excel
  const excelData = reservations.map(r => ({
    'ID': r.id,
    'Data rezerwacji': formatPolishDate(r.createdAt),
    'Użytkownik': r.userDisplayName || '-',
    'Email': r.userEmail || '-',
    'Przedmiot': r.itemName || '-',
    'Kategoria': getCategoryLabel(r.itemCategory || 'other'),
    'Cena katalogowa': r.itemPrice != null ? r.itemPrice : '-',
    'Rabat': r.discountType
      ? (r.discountType === 'percent' ? `${r.discountValue}%` : `${r.discountValue} zł/szt`)
      : '-',
    'Cena końcowa': r.customPrice != null ? r.customPrice : (r.itemPrice != null ? r.itemPrice : '-'),
    'Status': getStatusLabel(r.status),
    'Zam. admina': r.adminOrderId ? 'Tak' : '-',
    'Nr zamówienia': r.adminOrderId ? r.adminOrderId.substring(0, 8) : '-',
    'Notatka admina': r.adminNote || ''
  }));

  // Create workbook
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(excelData);

  // Set column widths
  worksheet['!cols'] = [
    { wch: 6 },   // ID
    { wch: 18 },  // Data
    { wch: 25 },  // Użytkownik
    { wch: 30 },  // Email
    { wch: 35 },  // Przedmiot
    { wch: 20 },  // Kategoria
    { wch: 14 },  // Cena katalogowa
    { wch: 14 },  // Rabat
    { wch: 14 },  // Cena końcowa
    { wch: 12 },  // Status
    { wch: 10 },  // Zam. admina
    { wch: 12 },  // Nr zamówienia
    { wch: 40 }   // Notatka admina
  ];

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Rezerwacje');

  // Generate buffer
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  // Generate filename with date
  const dateStr = new Date().toISOString().split('T')[0];
  const statusSuffix = statusFilter === 'all' ? 'wszystkie' : statusFilter === 'pending' ? 'aktywne' : statusFilter;
  const filename = `rezerwacje_${statusSuffix}_${dateStr}.xlsx`;

  logger.action('Reservations exported to Excel', {
    ...getRequestInfo(req),
    action: 'RESERVATIONS_EXPORT',
    details: {
      count: reservations.length,
      sortBy,
      order,
      statusFilter
    }
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

export default router;
