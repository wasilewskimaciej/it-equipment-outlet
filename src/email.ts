import nodemailer from 'nodemailer';
import { config } from './config';
import { Reservation } from './db';
import { escapeHtml } from './utils';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass
  }
});

function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    phone: 'Telefon komórkowy',
    desktop: 'Komputer stacjonarny',
    laptop: 'Laptop',
    monitor: 'Monitor',
    other: 'Inne'
  };
  return labels[category] || category;
}

/**
 * Format date for Polish timezone (Europe/Warsaw) for email display
 * Database stores UTC, this converts to Polish time for user-friendly emails
 */
function formatPolishDateTime(date: Date | string): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return dateObj.toLocaleString('pl-PL', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export async function sendReservationNotification(reservation: Reservation): Promise<boolean> {
  if (!config.smtp.user || !config.smtp.notificationEmail) {
    console.log('SMTP not configured, skipping email notification');
    console.log('Reservation:', reservation);
    return false;
  }

  const categoryLabel = getCategoryLabel(reservation.itemCategory || 'other');
  const formattedDate = formatPolishDateTime(reservation.createdAt);

  const mailOptions = {
    from: config.smtp.user,
    to: config.smtp.notificationEmail,
    subject: `[IT Equipment Outlet] Nowa rezerwacja #${reservation.id}: ${reservation.itemName}`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: #667eea; padding: 30px 20px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">Nowa rezerwacja w IT Equipment Outlet</h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 30px 20px;">
              <p style="font-size: 16px; color: #333333; margin: 0 0 20px 0;">
                Pracownik właśnie zarezerwował sprzęt. Szczegóły poniżej:
              </p>

              <!-- Info Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f9fa; border-left: 4px solid #667eea; margin: 20px 0;">
                <tr>
                  <td style="padding: 15px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 140px;">Sprzęt:</strong>
                          <strong style="color: #333333;">${escapeHtml(reservation.itemName)}</strong>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 140px;">ID:</strong>
                          <span style="display: inline-block; background-color: #667eea; color: #ffffff; padding: 2px 10px; border-radius: 12px; font-size: 13px;">#${reservation.itemId}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 140px;">Kategoria:</strong>
                          <span style="display: inline-block; background-color: #667eea; color: #ffffff; padding: 2px 10px; border-radius: 12px; font-size: 13px;">${escapeHtml(categoryLabel)}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 140px;">Pracownik:</strong>
                          <span style="color: #333333;">${escapeHtml(reservation.userDisplayName)}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 140px;">Email:</strong>
                          <a href="mailto:${escapeHtml(reservation.userEmail)}" style="color: #667eea; text-decoration: none;">${escapeHtml(reservation.userEmail)}</a>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0;">
                          <strong style="color: #666666; display: inline-block; width: 140px;">Data rezerwacji:</strong>
                          <span style="color: #333333;">${formattedDate}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin: 25px 0 0 0; color: #666666;">
                <strong>Następne kroki:</strong><br>
                Skontaktuj się z pracownikiem w celu ustalenia szczegółów odbioru i płatności.
              </p>

              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 20px;">
                <tr>
                  <td align="center">
                    <a href="${config.baseUrl}/admin.html" style="display: inline-block; padding: 12px 30px; background-color: #667eea; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">
                      Przejdź do Panelu Admina
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px; background-color: #f8f9fa; text-align: center; border-top: 1px solid #e9ecef;">
              <p style="margin: 5px 0; color: #666666; font-size: 13px;">IT Equipment Outlet - Używany sprzęt z działu IT</p>
              <p style="margin: 5px 0; color: #999999; font-size: 13px;">Ten email został wygenerowany automatycznie</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `
  };

  try {
    console.log('Sending reservation notification:', {
      to: mailOptions.to,
      subject: mailOptions.subject,
      itemName: reservation.itemName,
      htmlLength: mailOptions.html.length
    });
    await transporter.sendMail(mailOptions);
    console.log('Notification email sent successfully');
    return true;
  } catch (error) {
    console.error('Failed to send notification email:', error);
    return false;
  }
}

export async function sendAdminOrderNotification(
  itemName: string,
  itemCategory: string,
  quantity: number,
  targetUser: { displayName: string; email: string },
  admin: { displayName: string; email: string },
  discount?: { type: string; value: number } | null,
  customPrice?: number | null,
  originalPrice?: number | null,
  adminNote?: string
): Promise<boolean> {
  if (!config.smtp.user || !config.smtp.notificationEmail) {
    console.log('SMTP not configured, skipping admin order email notification');
    return false;
  }

  const categoryLabel = getCategoryLabel(itemCategory || 'other');
  const formattedDate = formatPolishDateTime(new Date());

  const discountText = discount
    ? (discount.type === 'percent' ? `${discount.value}%` : `${discount.value} zł/szt`)
    : 'Brak';

  const priceText = customPrice != null
    ? `${customPrice.toFixed(2)} zł/szt` + (quantity > 1 ? ` (łącznie: ${(customPrice * quantity).toFixed(2)} zł)` : '')
    : (originalPrice != null ? `${originalPrice.toFixed(2)} zł/szt (bez rabatu)` : 'Nie ustalono');

  const mailOptions = {
    from: config.smtp.user,
    to: config.smtp.notificationEmail,
    subject: `[IT Equipment Outlet] Zamówienie ręczne: ${quantity}x ${itemName}`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: #ed8936; padding: 30px 20px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">Zamówienie ręczne admina</h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 30px 20px;">
              <p style="font-size: 16px; color: #333333; margin: 0 0 20px 0;">
                Administrator utworzył ręczne zamówienie zbiorcze. Szczegóły poniżej:
              </p>

              <!-- Info Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f9fa; border-left: 4px solid #ed8936; margin: 20px 0;">
                <tr>
                  <td style="padding: 15px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 160px;">Sprzęt:</strong>
                          <strong style="color: #333333;">${escapeHtml(itemName)}</strong>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 160px;">Kategoria:</strong>
                          <span style="display: inline-block; background-color: #ed8936; color: #ffffff; padding: 2px 10px; border-radius: 12px; font-size: 13px;">${escapeHtml(categoryLabel)}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 160px;">Ilość:</strong>
                          <span style="display: inline-block; background-color: #333333; color: #ffffff; padding: 2px 10px; border-radius: 12px; font-size: 13px; font-weight: bold;">${quantity} szt.</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 160px;">Cena katalogowa:</strong>
                          <span style="color: #333333;">${originalPrice != null ? originalPrice.toFixed(2) + ' zł/szt' : '-'}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 160px;">Rabat:</strong>
                          <span style="color: ${discount ? '#e53e3e' : '#333333'}; font-weight: ${discount ? 'bold' : 'normal'};">${discountText}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 160px;">Cena końcowa:</strong>
                          <span style="color: #333333; font-weight: bold;">${priceText}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 160px;">Dla pracownika:</strong>
                          <span style="color: #333333;">${escapeHtml(targetUser.displayName)} (${escapeHtml(targetUser.email)})</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 160px;">Utworzył admin:</strong>
                          <span style="color: #333333;">${escapeHtml(admin.displayName)} (${escapeHtml(admin.email)})</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0;">
                          <strong style="color: #666666; display: inline-block; width: 160px;">Data:</strong>
                          <span style="color: #333333;">${formattedDate}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              ${adminNote ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #fffbeb; border-left: 4px solid #ecc94b; margin: 20px 0;">
                <tr>
                  <td style="padding: 15px 20px;">
                    <strong style="color: #666666;">Notatka:</strong><br>
                    <span style="color: #333333;">${escapeHtml(adminNote)}</span>
                  </td>
                </tr>
              </table>
              ` : ''}

              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 20px;">
                <tr>
                  <td align="center">
                    <a href="${config.baseUrl}/admin.html" style="display: inline-block; padding: 12px 30px; background-color: #ed8936; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">
                      Przejdź do Panelu Admina
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px; background-color: #f8f9fa; text-align: center; border-top: 1px solid #e9ecef;">
              <p style="margin: 5px 0; color: #666666; font-size: 13px;">IT Equipment Outlet - Używany sprzęt z działu IT</p>
              <p style="margin: 5px 0; color: #999999; font-size: 13px;">Ten email został wygenerowany automatycznie</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `
  };

  try {
    console.log('Sending admin order notification:', {
      to: mailOptions.to,
      subject: mailOptions.subject,
      quantity,
      itemName
    });
    await transporter.sendMail(mailOptions);
    console.log('Admin order notification email sent successfully');
    return true;
  } catch (error) {
    console.error('Failed to send admin order notification email:', error);
    return false;
  }
}

export async function sendAdminRightsNotification(
  targetUser: { email: string; displayName: string },
  isGranted: boolean,
  changedBy: { displayName: string; email: string }
): Promise<boolean> {
  if (!config.smtp.user) {
    console.log('SMTP not configured, skipping email notification');
    return false;
  }

  const actionDate = formatPolishDateTime(new Date());

  const mailOptions = {
    from: config.smtp.user,
    to: targetUser.email,
    subject: `[IT Equipment Outlet] Zmiana uprawnień administratora`,
    priority: 'high' as const,
    headers: {
      'X-Priority': '1',
      'X-MSMail-Priority': 'High',
      'Importance': 'high'
    },
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: ${isGranted ? '#667eea' : '#ed8936'}; padding: 30px 20px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">Zmiana uprawnień w IT Equipment Outlet</h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 30px 20px;">
              <p style="font-size: 16px; color: #333333; margin: 0 0 20px 0;">
                Dzień dobry,
              </p>
              <p style="font-size: 16px; color: #333333; margin: 0 0 20px 0;">
                Twoje konto w systemie IT Equipment Outlet zostało zaktualizowane:
              </p>

              <!-- Info Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f9fa; border-left: 4px solid ${isGranted ? '#667eea' : '#ed8936'}; margin: 20px 0;">
                <tr>
                  <td style="padding: 15px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 140px;">Zmiana:</strong>
                          <span style="display: inline-block; background-color: ${isGranted ? '#48bb78' : '#f56565'}; color: #ffffff; padding: 4px 12px; border-radius: 12px; font-size: 14px; font-weight: 600;">
                            ${isGranted ? '✓ NADANO' : '✗ ODEBRANO'} uprawnienia administratora
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 140px;">Zmiany dokonał:</strong>
                          <span style="color: #333333;">${escapeHtml(changedBy.displayName)}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 140px;">Email:</strong>
                          <a href="mailto:${escapeHtml(changedBy.email)}" style="color: #667eea; text-decoration: none;">${escapeHtml(changedBy.email)}</a>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0;">
                          <strong style="color: #666666; display: inline-block; width: 140px;">Data zmiany:</strong>
                          <span style="color: #333333;">${actionDate}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              ${isGranted ? `
              <p style="margin: 25px 0 0 0; color: #666666;">
                <strong>Nowe możliwości:</strong><br>
                • Zarządzanie sprzętem (dodawanie, edycja, usuwanie)<br>
                • Przeglądanie wszystkich rezerwacji<br>
                • Zarządzanie uprawnieniami użytkowników<br>
                • Dostęp do panelu administracyjnego
              </p>
              ` : `
              <p style="margin: 25px 0 0 0; color: #666666;">
                <strong>Zmiana uprawnień:</strong><br>
                Dostęp do panelu administracyjnego został ograniczony.<br>
                Nadal możesz przeglądać katalog i rezerwować sprzęt.
              </p>
              `}

              <p style="margin: 20px 0 0 0; color: #999999; font-size: 14px;">
                Jeśli nie oczekiwałeś tej zmiany lub masz pytania, skontaktuj się z administratorem IT.
              </p>

              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 20px;">
                <tr>
                  <td align="center">
                    <a href="${config.baseUrl}" style="display: inline-block; padding: 12px 30px; background-color: #667eea; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">
                      Przejdź do IT Equipment Outlet
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px; background-color: #f8f9fa; text-align: center; border-top: 1px solid #e9ecef;">
              <p style="margin: 5px 0; color: #666666; font-size: 13px;">IT Equipment Outlet - Używany sprzęt z działu IT</p>
              <p style="margin: 5px 0; color: #999999; font-size: 13px;">Ten email został wygenerowany automatycznie</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `
  };

  try {
    console.log('Sending admin rights notification:', {
      to: mailOptions.to,
      subject: mailOptions.subject,
      isGranted,
      changedBy: changedBy.email
    });
    await transporter.sendMail(mailOptions);
    console.log('Admin rights notification email sent successfully');
    return true;
  } catch (error) {
    console.error('Failed to send admin rights notification email:', error);
    return false;
  }
}

export async function sendCancellationNotification(
  reservation: Reservation,
  cancelledBy: { displayName: string; email: string; isAdmin: boolean }
): Promise<boolean> {
  if (!config.smtp.user || !config.smtp.notificationEmail) {
    console.log('SMTP not configured, skipping email notification');
    return false;
  }

  const categoryLabel = getCategoryLabel(reservation.itemCategory || 'other');
  const reservationDate = formatPolishDateTime(reservation.createdAt);
  const cancellationDate = formatPolishDateTime(new Date());

  const mailOptions = {
    from: config.smtp.user,
    to: config.smtp.notificationEmail,
    subject: `[IT Equipment Outlet] Anulowano rezerwację #${reservation.id}: ${reservation.itemName}`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: #e53e3e; padding: 30px 20px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">Anulowano rezerwację</h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 30px 20px;">
              <p style="font-size: 16px; color: #333333; margin: 0 0 20px 0;">
                Rezerwacja została anulowana. Sprzęt jest ponownie dostępny w ofercie.
              </p>

              <!-- Info Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f9fa; border-left: 4px solid #e53e3e; margin: 20px 0;">
                <tr>
                  <td style="padding: 15px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 160px;">Sprzęt:</strong>
                          <strong style="color: #333333;">${escapeHtml(reservation.itemName)}</strong>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 160px;">ID:</strong>
                          <span style="display: inline-block; background-color: #718096; color: #ffffff; padding: 2px 10px; border-radius: 12px; font-size: 13px;">#${reservation.itemId}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 160px;">Kategoria:</strong>
                          <span style="display: inline-block; background-color: #718096; color: #ffffff; padding: 2px 10px; border-radius: 12px; font-size: 13px;">${escapeHtml(categoryLabel)}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 160px;">Zarezerwował:</strong>
                          <span style="color: #333333;">${escapeHtml(reservation.userDisplayName)} (${escapeHtml(reservation.userEmail)})</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 160px;">Data rezerwacji:</strong>
                          <span style="color: #333333;">${reservationDate}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                          <strong style="color: #666666; display: inline-block; width: 160px;">Anulował:</strong>
                          <span style="color: #333333;">${escapeHtml(cancelledBy.displayName)} (${escapeHtml(cancelledBy.email)})</span>
                          ${cancelledBy.isAdmin ? '<span style="display: inline-block; background-color: #e53e3e; color: #ffffff; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-left: 5px;">Admin</span>' : ''}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0;">
                          <strong style="color: #666666; display: inline-block; width: 160px;">Data anulowania:</strong>
                          <span style="color: #333333;">${cancellationDate}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin: 25px 0 0 0; color: #666666;">
                <strong>Status:</strong><br>
                Sprzęt został przywrócony do statusu "dostępny" i może być ponownie zarezerwowany przez innych pracowników.
              </p>

              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 20px;">
                <tr>
                  <td align="center">
                    <a href="${config.baseUrl}/admin.html" style="display: inline-block; padding: 12px 30px; background-color: #667eea; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">
                      Przejdź do Panelu Admina
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px; background-color: #f8f9fa; text-align: center; border-top: 1px solid #e9ecef;">
              <p style="margin: 5px 0; color: #666666; font-size: 13px;">IT Equipment Outlet - Używany sprzęt z działu IT</p>
              <p style="margin: 5px 0; color: #999999; font-size: 13px;">Ten email został wygenerowany automatycznie</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `
  };

  try {
    console.log('Sending cancellation notification:', {
      to: mailOptions.to,
      subject: mailOptions.subject,
      itemName: reservation.itemName,
      cancelledBy: cancelledBy.email,
      htmlLength: mailOptions.html.length
    });
    await transporter.sendMail(mailOptions);
    console.log('Cancellation notification email sent successfully');
    return true;
  } catch (error) {
    console.error('Failed to send cancellation notification email:', error);
    return false;
  }
}
