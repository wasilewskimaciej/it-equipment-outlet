// State
let currentUser = null;
let items = [];
let reservations = [];
let favoritesHistory = [];
let favoritesHistoryExpanded = false;
const FAVORITES_HISTORY_COLLAPSED = 5;
const FAVORITES_HISTORY_PAGE_SIZE = 20;
let selectedItemId = null;
let editingItemImages = []; // For image management in edit modal
let draggedImageId = null;

// Categories that support quantity field
const QUANTITY_SUPPORTED_CATEGORIES = ['phone', 'monitor'];

// Helper function to check if category supports quantity
function supportsQuantity(category) {
  return QUANTITY_SUPPORTED_CATEGORIES.includes(category);
}

// DOM Elements
const userInfo = document.getElementById('userInfo');
const addItemForm = document.getElementById('addItemForm');
const addItemMessage = document.getElementById('addItemMessage');
const reservationsContainer = document.getElementById('reservationsContainer');
const favoritesHistoryContainer = document.getElementById('favoritesHistoryContainer');
const inventorySummaryContainer = document.getElementById('inventorySummaryContainer');
const itemsContainer = document.getElementById('itemsContainer');
const statusFilter = document.getElementById('statusFilter');

// Modals
const editModal = document.getElementById('editModal');
const editItemForm = document.getElementById('editItemForm');
const deleteModal = document.getElementById('deleteModal');
const deleteItemName = document.getElementById('deleteItemName');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
const historyModal = document.getElementById('historyModal');
const historyItemName = document.getElementById('historyItemName');
const adminNoteModal = document.getElementById('adminNoteModal');
const adminNoteItemName = document.getElementById('adminNoteItemName');
const adminNoteContent = document.getElementById('adminNoteContent');

// Toast notification system
function createToastContainer() {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

function showToast(message, type = 'info', duration = 4000) {
  const container = createToastContainer();

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <div class="toast-content">
      <span class="toast-message">${escapeHtml(message)}</span>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
  `;

  container.appendChild(toast);

  // Auto-remove after duration
  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 300);
  }, duration);

  return toast;
}

// Initialize
async function init() {
  await loadUser();
  await Promise.all([loadReservations(), loadFavoritesHistory(), loadItems()]);
  setupEventListeners();
}

// Load current user
async function loadUser() {
  try {
    const response = await fetch('/auth/me');
    currentUser = await response.json();
    if (currentUser) {
      userInfo.textContent = currentUser.displayName + ' (Admin)';
    }
  } catch (error) {
    console.error('Failed to load user:', error);
  }
}

// Load reservations
async function loadReservations() {
  try {
    const response = await fetch('/api/reservations');
    if (!response.ok) throw new Error('Failed to load reservations');
    reservations = await response.json();
    renderReservations();
  } catch (error) {
    console.error('Failed to load reservations:', error);
    reservationsContainer.innerHTML = '<div class="message error">Nie udało się załadować rezerwacji</div>';
  }
}

// Export reservations to Excel (only active/pending)
function exportReservations() {
  const sortSelect = document.getElementById('exportSort');
  const sortValue = sortSelect.value;
  const [sortBy, order] = sortValue.includes('-') ? sortValue.split('-') : [sortValue, 'asc'];

  const url = `/api/reservations/export/excel?sort=${sortBy}&order=${order}&status=pending`;

  // Trigger download
  window.location.href = url;
  showToast('Pobieranie pliku Excel...', 'info');
}

// Load favorites history
async function loadFavoritesHistory(loadMore = false) {
  try {
    const limit = loadMore ? FAVORITES_HISTORY_PAGE_SIZE : FAVORITES_HISTORY_COLLAPSED;
    const offset = loadMore ? favoritesHistory.length : 0;
    const response = await fetch(`/api/favorites/history?limit=${limit}&offset=${offset}`);
    if (!response.ok) throw new Error('Failed to load favorites history');
    const newHistory = await response.json();

    if (loadMore) {
      favoritesHistory = [...favoritesHistory, ...newHistory];
    } else {
      favoritesHistory = newHistory;
    }

    renderFavoritesHistory();
  } catch (error) {
    console.error('Failed to load favorites history:', error);
    favoritesHistoryContainer.innerHTML = '<div class="message error">Nie udało się załadować historii ulubionych</div>';
  }
}

// Toggle favorites history expanded/collapsed
async function toggleFavoritesHistory() {
  favoritesHistoryExpanded = !favoritesHistoryExpanded;
  if (favoritesHistoryExpanded && favoritesHistory.length <= FAVORITES_HISTORY_COLLAPSED) {
    await loadFavoritesHistory(true);
  } else {
    renderFavoritesHistory();
  }
}

// Load more favorites history
async function loadMoreFavoritesHistory() {
  await loadFavoritesHistory(true);
}

// Render favorites history
function renderFavoritesHistory() {
  if (favoritesHistory.length === 0) {
    favoritesHistoryContainer.innerHTML = '<div class="empty-state"><p>Brak historii ulubionych</p></div>';
    return;
  }

  const displayedHistory = favoritesHistoryExpanded
    ? favoritesHistory
    : favoritesHistory.slice(0, FAVORITES_HISTORY_COLLAPSED);

  const hasMore = favoritesHistoryExpanded && favoritesHistory.length >= FAVORITES_HISTORY_PAGE_SIZE;
  const canExpand = !favoritesHistoryExpanded && favoritesHistory.length >= FAVORITES_HISTORY_COLLAPSED;

  favoritesHistoryContainer.innerHTML = `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Użytkownik</th>
            <th>Akcja</th>
            <th>Przedmiot</th>
          </tr>
        </thead>
        <tbody>
          ${displayedHistory.map(entry => `
            <tr class="favorite-history-${entry.action}">
              <td>${formatDate(entry.createdAt)}</td>
              <td>
                <span title="${escapeHtml(entry.userEmail || '')}">${escapeHtml(entry.userDisplayName || 'Nieznany')}</span>
              </td>
              <td>
                <span class="favorite-action ${entry.action}">
                  ${entry.action === 'add' ? '♥ Polubił' : '♡ Odlubił'}
                </span>
              </td>
              <td>
                ${entry.itemName
                  ? `<strong>#${entry.itemId}</strong> - ${escapeHtml(entry.itemName)} <span class="item-category-badge">${getCategoryLabel(entry.itemCategory || '')}</span>`
                  : `<span style="color: var(--text-muted);">Przedmiot usunięty (#${entry.itemId})</span>`
                }
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div class="history-actions">
      ${canExpand ? `<button class="btn btn-secondary btn-sm" onclick="toggleFavoritesHistory()">Pokaż więcej ▼</button>` : ''}
      ${favoritesHistoryExpanded ? `
        <button class="btn btn-secondary btn-sm" onclick="toggleFavoritesHistory()">Zwiń ▲</button>
        ${hasMore ? `<button class="btn btn-secondary btn-sm" onclick="loadMoreFavoritesHistory()">Załaduj więcej...</button>` : ''}
      ` : ''}
    </div>
  `;
}

// Render reservations with sorting (only active/pending)
function renderReservations() {
  // Get sort value
  const sortSelect = document.getElementById('exportSort');
  const sortValue = sortSelect ? sortSelect.value : 'date-desc';

  // Filter only active (pending) reservations
  let filtered = reservations.filter(r => r.status === 'pending');

  // Sort reservations
  const [sortBy, order] = sortValue.includes('-') ? sortValue.split('-') : [sortValue, 'asc'];
  filtered.sort((a, b) => {
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

  if (filtered.length === 0) {
    reservationsContainer.innerHTML = '<div class="empty-state"><p>Brak aktywnych rezerwacji</p></div>';
    return;
  }

  reservationsContainer.innerHTML = `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>ID produktu</th>
            <th>Sprzęt</th>
            <th>Kategoria</th>
            <th>Cena</th>
            <th>Zarezerwowany przez</th>
            <th>Email</th>
            <th>Data</th>
            <th>Notatka</th>
            <th>Akcje</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(r => `
            <tr>
              <td><strong title="Unikalny numer produktu w systemie" style="cursor: help; color: var(--accent-color);">${r.itemId}</strong></td>
              <td>${escapeHtml(r.itemName)}</td>
              <td>${getCategoryLabel(r.itemCategory)}</td>
              <td>${r.customPrice != null
                ? `<span title="Katalogowa: ${r.itemPrice != null ? r.itemPrice.toFixed(2) : '?'} zł | Rabat: ${r.discountType === 'percent' ? r.discountValue + '%' : (r.discountType === 'fixed' ? r.discountValue + ' zł/szt' : '-')}" style="color: var(--success-color); cursor: help;">${r.customPrice.toFixed(2)} zł ✱</span>`
                : (r.itemPrice != null ? r.itemPrice.toFixed(2) + ' zł' : '-')
              }</td>
              <td>${escapeHtml(r.userDisplayName)}</td>
              <td><a href="mailto:${escapeHtml(r.userEmail)}">${escapeHtml(r.userEmail)}</a></td>
              <td>${formatDate(r.createdAt)}</td>
              <td>
                ${r.adminNote
                  ? `<span class="admin-note-preview" onclick="openReservationNoteModal(${r.id})" title="${escapeHtml(r.adminNote)}">📝</span>`
                  : `<span class="admin-note-preview" onclick="openReservationNoteModal(${r.id})" title="Dodaj notatkę" style="opacity: 0.3; cursor: pointer;">📝</span>`
                }
              </td>
              <td>
                <button class="btn btn-success btn-sm" onclick="completeReservation(${r.id})">Sfinalizuj</button>
                <button class="btn btn-danger btn-sm" onclick="cancelReservation(${r.id})">Anuluj</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// Get status label in Polish
function getStatusLabel(status) {
  const labels = {
    pending: 'Oczekująca',
    completed: 'Zrealizowana',
    cancelled: 'Anulowana'
  };
  return labels[status] || status;
}

// Render item status breakdown (available/reserved/sold counts)
function renderItemStatusBreakdown(item) {
  const available = item.quantity || 0;
  const reserved = item.reservedCount || 0;
  const sold = item.soldCount || 0;

  const parts = [];

  if (available > 0) {
    parts.push(`<span class="item-status available" title="Dostępne do rezerwacji">${available} dost.</span>`);
  }
  if (reserved > 0) {
    // Build tooltip with reserving users
    let reservedTooltip = 'Zarezerwowane - czekają na finalizację';
    if (item.reservingUsers) {
      const names = item.reservingUsers.split(' | ');
      const emails = item.reservingEmails ? item.reservingEmails.split(' | ') : [];
      const userList = names.map((n, i) => `${n.trim()} (${emails[i] ? emails[i].trim() : ''})`).join('&#10;');
      reservedTooltip = `Zarezerwowane:&#10;${userList}`;
    }
    parts.push(`<span class="item-status reserved" style="cursor: help;" title="${reservedTooltip}">${reserved} rez.</span>`);
  }
  if (sold > 0) {
    parts.push(`<span class="item-status sold" title="Sprzedane - rezerwacje sfinalizowane">${sold} sprz.</span>`);
  }

  // If no parts (all zeros), show a muted dash
  if (parts.length === 0) {
    return '<span style="color: var(--text-muted);">-</span>';
  }

  return parts.join(' ');
}

// Render inventory summary (value by status)
function renderInventorySummary() {
  if (!items || items.length === 0) {
    inventorySummaryContainer.innerHTML = '<p style="color: var(--text-muted);">Brak przedmiotów w magazynie</p>';
    return;
  }

  // Calculate totals
  let availableCount = 0, availableValue = 0;
  let reservedCount = 0, reservedValue = 0;
  let soldCount = 0, soldValue = 0;

  items.forEach(item => {
    const price = item.price || 0;

    // Available = quantity (items that can still be reserved)
    if (item.quantity > 0) {
      availableCount += item.quantity;
      availableValue += item.quantity * price;
    }

    // Reserved = active reservations
    const reserved = item.reservedCount || 0;
    if (reserved > 0) {
      reservedCount += reserved;
      reservedValue += reserved * price;
    }

    // Sold = completed reservations from history (use stored value from DB)
    const sold = item.soldCount || 0;
    if (sold > 0) {
      soldCount += sold;
      soldValue += item.soldValue || 0;
    }
  });

  const formatValue = (val) => val.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł';

  inventorySummaryContainer.innerHTML = `
    <div class="inventory-summary-grid">
      <div class="summary-card available">
        <div class="summary-label">Dostępne</div>
        <div class="summary-value">${formatValue(availableValue)}</div>
        <div class="summary-count">${availableCount} szt.</div>
      </div>
      <div class="summary-card reserved">
        <div class="summary-label">Zarezerwowane</div>
        <div class="summary-value">${formatValue(reservedValue)}</div>
        <div class="summary-count">${reservedCount} szt.</div>
      </div>
      <div class="summary-card sold">
        <div class="summary-label">Sprzedane</div>
        <div class="summary-value">${formatValue(soldValue)}</div>
        <div class="summary-count">${soldCount} szt.</div>
      </div>
    </div>
  `;
}

// Load items
async function loadItems() {
  try {
    const response = await fetch('/api/items/all');
    if (!response.ok) throw new Error('Failed to load items');
    items = await response.json();
    renderItems();
    renderInventorySummary();
  } catch (error) {
    console.error('Failed to load items:', error);
    itemsContainer.innerHTML = '<div class="message error">Nie udało się załadować przedmiotów</div>';
  }
}

// Render items
function renderItems() {
  const status = statusFilter.value;
  let filtered = items;

  // Dynamic filtering based on actual counts
  if (status === 'available') {
    // Items with quantity > 0 (can still be reserved)
    filtered = items.filter(i => i.quantity > 0);
  } else if (status === 'reserved') {
    // Items with active reservations
    filtered = items.filter(i => (i.reservedCount || 0) > 0);
  } else if (status === 'sold') {
    // Items with completed sales in history
    filtered = items.filter(i => (i.soldCount || 0) > 0);
  } else if (status === 'hidden') {
    // Items that are hidden from catalog
    filtered = items.filter(i => i.isVisible === 0);
  }
  // else: show all

  if (filtered.length === 0) {
    itemsContainer.innerHTML = '<div class="empty-state"><p>Brak przedmiotów</p></div>';
    return;
  }

  itemsContainer.innerHTML = `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Zdjęcie</th>
            <th>Nazwa</th>
            <th>Kategoria</th>
            <th>Cena</th>
            <th>Status</th>
            <th>Ilość</th>
            <th>${status === 'reserved' ? 'Zarezerwowano' : status === 'sold' ? 'Sprzedano' : 'Dodano'}</th>
            <th>Ulubione</th>
            <th>Notatka</th>
            <th>Kupujący</th>
            <th>Akcje</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(item => {
            const imageCount = item.images ? item.images.length : (item.imagePath ? 1 : 0);
            // Use thumbnail for faster loading (with fallback to original)
            const firstImage = item.images && item.images.length > 0 ? item.images[0] : null;
            const mainImage = firstImage ? (firstImage.thumbnailPath || firstImage.imagePath) : item.imagePath;
            return `
            <tr>
              <td>
                <strong title="Unikalny numer produktu w systemie" style="cursor: help; color: var(--accent-color);">${item.id}</strong>
                ${item.isVisible === 0 ? ' <span class="badge-hidden" title="Ukryty w katalogu">👁️</span>' : ''}
              </td>
              <td>
                ${mainImage
                  ? `<div style="position: relative; display: inline-block;">
                       <img src="${mainImage}" alt="" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px;">
                       ${imageCount > 1 ? `<span style="position: absolute; bottom: 2px; right: 2px; background: rgba(0,0,0,0.6); color: white; font-size: 0.65rem; padding: 1px 4px; border-radius: 3px;">${imageCount}</span>` : ''}
                     </div>`
                  : '<span style="color: var(--text-muted);">Brak</span>'
                }
              </td>
              <td>${escapeHtml(item.name)}</td>
              <td>${getCategoryLabel(item.category)}</td>
              <td>${item.price ? item.price.toFixed(2) + ' zł' : '-'}</td>
              <td>${renderItemStatusBreakdown(item)}</td>
              <td>
                ${supportsQuantity(item.category) && item.quantity > 1
                  ? `<strong title="Dostępne sztuki">${item.quantity}</strong>`
                  : supportsQuantity(item.category)
                    ? `<span style="color: var(--text-muted);">${item.quantity || 1}</span>`
                    : '<span style="color: var(--text-muted);">-</span>'
                }
              </td>
              <td>${(() => {
                if (status === 'sold' && item.lastSoldAt) {
                  return formatDateShort(item.lastSoldAt) + '<br><span style="color: var(--text-muted); font-size: 0.75em;" title="Data dodania: ' + formatDateTitle(item.createdAt) + '">dodano: ' + formatDateShort(item.createdAt) + '</span>';
                } else if (status === 'reserved' && item.lastReservedAt) {
                  return formatDateShort(item.lastReservedAt) + '<br><span style="color: var(--text-muted); font-size: 0.75em;" title="Data dodania: ' + formatDateTitle(item.createdAt) + '">dodano: ' + formatDateShort(item.createdAt) + '</span>';
                } else {
                  return formatDateShort(item.createdAt);
                }
              })()}</td>
              <td>
                ${item.favoriteCount > 0
                  ? `<span class="favorite-count-badge">♥ ${item.favoriteCount}</span>`
                  : '<span style="color: var(--text-muted);">-</span>'
                }
              </td>
              <td>
                ${item.adminNote
                  ? `<span class="admin-note-preview" onclick="openAdminNoteModal(${item.id})" title="Kliknij aby zobaczyć notatkę">📝</span>`
                  : '<span style="color: var(--text-muted);">-</span>'
                }
              </td>
              <td>
                ${item.buyers
                  ? (() => {
                      const names = item.buyers.split(' | ');
                      const emails = item.buyerEmails ? item.buyerEmails.split(' | ') : [];
                      if (names.length === 1) {
                        return '<span title="' + escapeHtml(emails[0] || '') + '">' + escapeHtml(names[0]) + '</span>';
                      } else {
                        const tooltip = names.map((n, i) => n.trim() + ' (' + (emails[i] ? emails[i].trim() : '') + ')').join('\n');
                        return '<span title="' + escapeHtml(tooltip) + '" style="cursor: help;">' + escapeHtml(names[0]) + ' <span style="color: var(--text-muted); font-size: 0.8em;">+' + (names.length - 1) + '</span></span>';
                      }
                    })()
                  : '<span style="color: var(--text-muted);">-</span>'
                }
              </td>
              <td>
                <button class="btn btn-secondary btn-sm" onclick="openHistoryModal(${item.id})">Historia</button>
                <button class="btn btn-primary btn-sm" onclick="openEditModal(${item.id})">Edytuj</button>
                <button class="btn btn-danger btn-sm" onclick="openDeleteModal(${item.id})">Usuń</button>
              </td>
            </tr>
          `;}).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// Add item
async function addItem(e) {
  e.preventDefault();

  const formData = new FormData();
  formData.append('name', document.getElementById('itemName').value);
  formData.append('category', document.getElementById('itemCategory').value);
  formData.append('description', document.getElementById('itemDescription').value);
  formData.append('price', document.getElementById('itemPrice').value);
  formData.append('adminNote', document.getElementById('itemAdminNote').value);

  // Only send quantity if category supports it
  const category = document.getElementById('itemCategory').value;
  if (supportsQuantity(category)) {
    formData.append('quantity', document.getElementById('itemQuantity').value);
  }

  // Add visibility status
  formData.append('isVisible', document.getElementById('itemVisible').checked ? '1' : '0');

  const imageFiles = document.getElementById('itemImages').files;
  for (let i = 0; i < imageFiles.length; i++) {
    formData.append('images', imageFiles[i]);
  }

  try {
    const response = await fetch('/api/items', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to add item');
    }

    addItemMessage.innerHTML = '<div class="message success">Przedmiot dodany pomyślnie!</div>';
    addItemForm.reset();
    await loadItems();

    setTimeout(() => { addItemMessage.innerHTML = ''; }, 3000);
  } catch (error) {
    addItemMessage.innerHTML = `<div class="message error">Błąd: ${escapeHtml(error.message)}</div>`;
  }
}

// Edit modal
function openEditModal(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;

  document.getElementById('editItemId').value = item.id;
  document.getElementById('editItemName').value = item.name;
  document.getElementById('editItemCategory').value = item.category;
  document.getElementById('editItemDescription').value = item.description || '';
  document.getElementById('editItemPrice').value = item.price || '';
  document.getElementById('editItemStatus').value = item.status;
  document.getElementById('editItemAdminNote').value = item.adminNote || '';
  document.getElementById('editItemQuantity').value = item.quantity || 1;
  document.getElementById('editItemVisible').checked = item.isVisible !== 0;

  // Show/hide quantity field based on category
  const quantityGroup = document.getElementById('editItemQuantityGroup');
  if (supportsQuantity(item.category)) {
    quantityGroup.style.display = 'block';
  } else {
    quantityGroup.style.display = 'none';
  }

  // Load images for management
  editingItemImages = item.images ? [...item.images] : [];
  renderEditImages();

  editModal.classList.add('active');
}

// History modal
async function openHistoryModal(id) {
  const item = items.find(i => i.id === id);
  historyItemName.textContent = item ? item.name : '';
  historyModal.classList.add('active');
  await loadItemHistory(id, item ? item.createdAt : undefined);
}

function closeHistoryModal() {
  historyModal.classList.remove('active');
  document.getElementById('itemHistoryContainer').innerHTML = '<div class="loading-small">Ładowanie historii...</div>';
}

// Admin Note modal
function openAdminNoteModal(id) {
  const item = items.find(i => i.id === id);
  adminNoteItemName.textContent = item ? item.name : '';
  adminNoteContent.textContent = item ? (item.adminNote || '') : '';
  adminNoteModal.classList.add('active');
}

function closeAdminNoteModal() {
  adminNoteModal.classList.remove('active');
  adminNoteContent.textContent = '';
}

// Load and render item history
async function loadItemHistory(itemId, createdAt) {
  const container = document.getElementById('itemHistoryContainer');
  container.innerHTML = '<div class="loading-small">Ładowanie historii...</div>';

  try {
    // Fetch both history and item details (to get createdBy info)
    const [historyResponse, itemResponse] = await Promise.all([
      fetch(`/api/items/${itemId}/history`),
      fetch(`/api/items/${itemId}`)
    ]);

    if (!historyResponse.ok || !itemResponse.ok) throw new Error('Failed to load history');

    const historyData = await historyResponse.json();
    const item = await itemResponse.json();

    // historyData now contains { history: [], activeReservations: [], editHistory: [] }
    renderItemHistory(
      historyData.history || [],
      historyData.activeReservations || [],
      historyData.editHistory || [],
      item
    );
  } catch (error) {
    console.error('Failed to load item history:', error);
    // Find item in current items list to get createdAt
    const item = items.find(i => i.id === itemId);
    container.innerHTML = `
      <div class="history-timeline">
        <div class="history-entry">
          <span class="history-icon">📦</span>
          <span class="history-text">Dodano do systemu</span>
          <span class="history-date">${item ? formatDate(item.createdAt) : 'Nieznana data'}</span>
        </div>
      </div>
    `;
  }
}

// Render item history timeline
function renderItemHistory(history, activeReservations, editHistory, item) {
  const container = document.getElementById('itemHistoryContainer');
  const createdByText = item.createdByDisplayName
    ? `Dodano przez ${escapeHtml(item.createdByDisplayName)}`
    : 'Dodano do systemu';

  // Combine active reservations, history, and edits
  const allEntries = [];

  // Add active reservations
  activeReservations.forEach(res => {
    allEntries.push({
      type: 'active',
      icon: '🔵',
      text: `Aktywna rezerwacja - ${escapeHtml(res.userDisplayName)}`,
      dateText: formatDate(res.createdAt),
      timestamp: new Date(res.createdAt).getTime()
    });
  });

  // Add edit history entries
  editHistory.forEach(edit => {
    const changes = JSON.parse(edit.changes);
    const changesText = Object.entries(changes)
      .map(([key, value]) => {
        const fieldLabels = {
          name: 'Nazwa',
          description: 'Opis',
          category: 'Kategoria',
          price: 'Cena',
          status: 'Status',
          imagePath: 'Zdjęcie'
        };
        const fieldLabel = fieldLabels[key] || key;
        return `${fieldLabel}: ${value === undefined ? 'usunięto' : value}`;
      })
      .join(', ');

    allEntries.push({
      type: 'edit',
      icon: '✏️',
      text: `Edytowano przez ${escapeHtml(edit.userDisplayName)} - ${changesText}`,
      dateText: formatDate(edit.createdAt),
      timestamp: new Date(edit.createdAt).getTime()
    });
  });

  // Add history entries
  history.forEach(entry => {
    let icon, text, dateText, timestamp;

    if (entry.status === 'completed') {
      icon = '✅';
      text = `Sprzedano - ${escapeHtml(entry.userDisplayName)}`;
      dateText = formatDate(entry.completedAt);
      timestamp = new Date(entry.completedAt).getTime();
    } else if (entry.status === 'cancelled') {
      icon = '❌';
      text = `Anulowano rezerwację - ${escapeHtml(entry.userDisplayName)}`;
      dateText = formatDate(entry.cancelledAt);
      timestamp = new Date(entry.cancelledAt).getTime();
    } else {
      icon = '📋';
      text = `Rezerwacja - ${escapeHtml(entry.userDisplayName)}`;
      dateText = formatDate(entry.createdAt);
      timestamp = new Date(entry.createdAt).getTime();
    }

    allEntries.push({
      type: entry.status,
      icon,
      text,
      dateText,
      timestamp
    });
  });

  // Sort by timestamp descending (newest first)
  allEntries.sort((a, b) => b.timestamp - a.timestamp);

  if (allEntries.length === 0) {
    container.innerHTML = `
      <div class="history-timeline">
        <div class="history-entry">
          <span class="history-icon">📦</span>
          <span class="history-text">${createdByText}</span>
          <span class="history-date">${formatDate(item.createdAt)}</span>
        </div>
        <div class="history-empty">Brak historii rezerwacji</div>
      </div>
    `;
    return;
  }

  const historyHtml = allEntries.map(entry => `
    <div class="history-entry history-${entry.type}">
      <span class="history-icon">${entry.icon}</span>
      <span class="history-text">${entry.text}</span>
      <span class="history-date">${entry.dateText}</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="history-timeline">
      ${historyHtml}
      <div class="history-entry">
        <span class="history-icon">📦</span>
        <span class="history-text">${createdByText}</span>
        <span class="history-date">${formatDate(item.createdAt)}</span>
      </div>
    </div>
  `;
}

function closeEditModal() {
  editModal.classList.remove('active');
  editItemForm.reset();
  editingItemImages = [];
  document.getElementById('editImagesContainer').innerHTML = '';
}

// Render images in edit modal
function renderEditImages() {
  const container = document.getElementById('editImagesContainer');

  if (editingItemImages.length === 0) {
    container.innerHTML = '<div class="edit-images-empty">Brak zdjęć. Dodaj zdjęcia poniżej.</div>';
    return;
  }

  container.innerHTML = editingItemImages.map((img, index) => `
    <div class="edit-image-item ${index === 0 ? 'first' : ''}"
         draggable="true"
         data-image-id="${img.id}"
         ondragstart="handleDragStart(event, ${img.id})"
         ondragover="handleDragOver(event)"
         ondragleave="handleDragLeave(event)"
         ondrop="handleDrop(event, ${img.id})">
      <img src="${img.imagePath}" alt="Zdjęcie ${index + 1}">
      ${index === 0 ? '<span class="image-badge">Główne</span>' : ''}
      <button type="button" class="delete-image-btn" onclick="deleteImage(${img.id})" title="Usuń zdjęcie">&times;</button>
    </div>
  `).join('');
}

// Drag and drop handlers
function handleDragStart(e, imageId) {
  draggedImageId = imageId;
  e.target.classList.add('dragging');
}

function handleDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function handleDrop(e, targetId) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');

  if (draggedImageId === targetId) return;

  // Reorder images
  const draggedIndex = editingItemImages.findIndex(img => img.id === draggedImageId);
  const targetIndex = editingItemImages.findIndex(img => img.id === targetId);

  if (draggedIndex === -1 || targetIndex === -1) return;

  const [draggedItem] = editingItemImages.splice(draggedIndex, 1);
  editingItemImages.splice(targetIndex, 0, draggedItem);

  renderEditImages();
  draggedImageId = null;
}

// Delete image
async function deleteImage(imageId) {
  if (!confirm('Czy na pewno chcesz usunąć to zdjęcie?')) return;

  const itemId = document.getElementById('editItemId').value;

  try {
    const response = await fetch(`/api/items/${itemId}/images/${imageId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete image');
    }

    // Remove from local array and re-render
    editingItemImages = editingItemImages.filter(img => img.id !== imageId);
    renderEditImages();
  } catch (error) {
    showToast('Błąd: ' + error.message, 'error');
  }
}

// Add new images to existing item
async function addNewImages(files) {
  if (!files || files.length === 0) return;

  const itemId = document.getElementById('editItemId').value;
  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append('images', files[i]);
  }

  try {
    const response = await fetch(`/api/items/${itemId}/images`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to add images');
    }

    const updatedItem = await response.json();
    editingItemImages = updatedItem.images || [];
    renderEditImages();

    // Clear file input
    document.getElementById('editNewImages').value = '';
  } catch (error) {
    showToast('Błąd: ' + error.message, 'error');
  }
}

// Save edit
async function saveEdit(e) {
  e.preventDefault();

  const id = document.getElementById('editItemId').value;

  // First save image order if changed
  if (editingItemImages.length > 0) {
    const imageOrder = editingItemImages.map((img, index) => ({
      id: img.id,
      sortOrder: index
    }));

    try {
      const orderResponse = await fetch(`/api/items/${id}/images/order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageOrder })
      });

      if (!orderResponse.ok) {
        const error = await orderResponse.json();
        throw new Error(error.error || 'Failed to update image order');
      }
    } catch (error) {
      showToast('Błąd zapisywania kolejności zdjęć: ' + error.message, 'error');
      return;
    }
  }

  // Then save item data
  const formData = new FormData();
  formData.append('name', document.getElementById('editItemName').value);
  formData.append('category', document.getElementById('editItemCategory').value);
  formData.append('description', document.getElementById('editItemDescription').value);
  formData.append('price', document.getElementById('editItemPrice').value);
  formData.append('status', document.getElementById('editItemStatus').value);
  formData.append('adminNote', document.getElementById('editItemAdminNote').value);
  formData.append('quantity', document.getElementById('editItemQuantity').value);
  formData.append('isVisible', document.getElementById('editItemVisible').checked ? '1' : '0');

  try {
    const response = await fetch(`/api/items/${id}`, {
      method: 'PUT',
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update item');
    }

    closeEditModal();
    await loadItems();
  } catch (error) {
    showToast('Błąd: ' + error.message, 'error');
  }
}

// Delete modal
function openDeleteModal(id) {
  const item = items.find(i => i.id === id);
  selectedItemId = id;
  deleteItemName.textContent = item ? item.name : '';
  deleteModal.classList.add('active');
}

function closeDeleteModal() {
  selectedItemId = null;
  deleteModal.classList.remove('active');
}

// Confirm delete
async function confirmDelete() {
  if (!selectedItemId) return;

  try {
    const response = await fetch(`/api/items/${selectedItemId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete item');
    }

    closeDeleteModal();
    await loadItems();
  } catch (error) {
    showToast('Błąd: ' + error.message, 'error');
  }
}

// Complete reservation (item sold)
async function completeReservation(id) {
  if (!confirm('Czy na pewno chcesz sfinalizować rezerwację? Przedmiot zostanie oznaczony jako sprzedany.')) {
    return;
  }

  try {
    const response = await fetch(`/api/reservations/${id}/complete`, {
      method: 'POST'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to complete reservation');
    }

    await Promise.all([loadReservations(), loadItems()]);
  } catch (error) {
    showToast('Błąd: ' + error.message, 'error');
  }
}

// Cancel reservation
async function cancelReservation(id) {
  if (!confirm('Czy na pewno chcesz anulować rezerwację? Przedmiot wróci do puli dostępnych.')) {
    return;
  }

  try {
    const response = await fetch(`/api/reservations/${id}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to cancel reservation');
    }

    await Promise.all([loadReservations(), loadItems()]);
  } catch (error) {
    showToast('Błąd: ' + error.message, 'error');
  }
}

// Reservation note modal
let currentReservationNoteId = null;

function openReservationNoteModal(reservationId) {
  const reservation = reservations.find(r => r.id === reservationId);
  currentReservationNoteId = reservationId;
  document.getElementById('reservationNoteItemName').textContent = reservation ? reservation.itemName : '';
  document.getElementById('reservationNoteTextarea').value = reservation && reservation.adminNote ? reservation.adminNote : '';
  document.getElementById('reservationNoteModal').classList.add('active');
  // Focus on textarea after modal opens
  setTimeout(() => document.getElementById('reservationNoteTextarea').focus(), 100);
}

function closeReservationNoteModal() {
  document.getElementById('reservationNoteModal').classList.remove('active');
  document.getElementById('reservationNoteTextarea').value = '';
  currentReservationNoteId = null;
}

async function saveReservationNoteFromModal(event) {
  event.preventDefault();

  if (!currentReservationNoteId) return;

  const noteValue = document.getElementById('reservationNoteTextarea').value.trim();

  try {
    const response = await fetch(`/api/reservations/${currentReservationNoteId}/note`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminNote: noteValue || null })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Nie udało się zapisać notatki');
    }

    // Update local reservations array
    const reservation = reservations.find(r => r.id === currentReservationNoteId);
    if (reservation) {
      reservation.adminNote = noteValue || null;
    }

    closeReservationNoteModal();
    renderReservations(); // Re-render to show updated emoji/tooltip
    showToast('Notatka została zapisana', 'success');
  } catch (error) {
    showToast('Nie udało się zapisać notatki: ' + error.message, 'error');
  }
}

// Helpers
function getCategoryLabel(category) {
  const labels = { phone: 'Telefon komórkowy', desktop: 'Komputer stacjonarny', laptop: 'Laptop', monitor: 'Monitor', other: 'Inne' };
  return labels[category] || escapeHtml(category);
}

function getStatusLabel(status) {
  const labels = { available: 'Dostępny', reserved: 'Zarezerwowany', sold: 'Sprzedany' };
  return labels[status] || status;
}

function formatDate(dateStr) {
  // SQLite stores dates in UTC, append Z to indicate UTC timezone
  const utcDate = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z';
  return new Date(utcDate).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
}

function formatDateTitle(dateStr) {
  const utcDate = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z';
  return new Date(utcDate).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' });
}

function formatDateShort(dateStr) {
  // SQLite stores dates in UTC, append Z to indicate UTC timezone
  const utcDate = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z';
  const date = new Date(utcDate);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const localDateStr = date.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' });

  // Show relative time with warning color for old items
  if (diffDays > 180) {
    return `<span style="color: #d97706;" title="${localDateStr}">⚠️ ${Math.floor(diffDays / 30)} mies.</span>`;
  } else if (diffDays > 30) {
    return `<span title="${localDateStr}">${Math.floor(diffDays / 30)} mies.</span>`;
  } else if (diffDays > 0) {
    return `<span title="${localDateStr}">${diffDays} dni</span>`;
  } else {
    return `<span title="${localDateStr}">Dziś</span>`;
  }
}

// Escape HTML — bezpieczne w kontekście tekstu ORAZ atrybutów w cudzysłowach
// (escapuje też " i ', czego wariant oparty o textContent/innerHTML nie robił).
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Export items to CSV
function exportItemsToCSV(fullVersion = false) {
  // Respect current status filter (same logic as renderItems)
  const status = statusFilter.value;
  let itemsToExport = items;
  if (status === 'available') itemsToExport = items.filter(i => i.quantity > 0);
  else if (status === 'reserved') itemsToExport = items.filter(i => (i.reservedCount || 0) > 0);
  else if (status === 'sold') itemsToExport = items.filter(i => (i.soldCount || 0) > 0);
  else if (status === 'hidden') itemsToExport = items.filter(i => i.isVisible === 0);

  if (itemsToExport.length === 0) {
    showToast('Brak przedmiotów do eksportu', 'warning');
    return;
  }

  const baseUrl = window.location.origin;

  // CSV header - conditional columns
  const headers = fullVersion
    ? ['ID', 'Nazwa', 'Kategoria', 'Cena', 'Dostępne', 'Zarezerwowane', 'Sprzedane', 'Kupujący', 'Email kupujących', 'Data sprzedaży', 'Widoczność', 'Data dodania', 'Ulubione', 'Liczba zdjęć', 'URL głównego zdjęcia', 'Opis', 'Wszystkie zdjęcia']
    : ['ID', 'Nazwa', 'Kategoria', 'Cena', 'Dostępne', 'Zarezerwowane', 'Sprzedane', 'Kupujący', 'Email kupujących', 'Data sprzedaży', 'Widoczność', 'Data dodania', 'Ulubione', 'Liczba zdjęć', 'URL głównego zdjęcia'];

  // Helper: escape a value for CSV (wrap in quotes if needed)
  function csvEscape(val) {
    if (val == null) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""').replace(/[\r\n]+/g, ' ') + '"';
    }
    return str;
  }

  // CSV rows
  const rows = itemsToExport.map(item => {
    const mainImage = item.images && item.images.length > 0 ? item.images[0].imagePath : item.imagePath;
    const imageCount = item.images ? item.images.length : (item.imagePath ? 1 : 0);
    const utcDate = item.createdAt.endsWith('Z') ? item.createdAt : item.createdAt + 'Z';
    const dateStr = new Date(utcDate).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' });
    const soldDateStr = item.lastSoldAt ? new Date(item.lastSoldAt.endsWith('Z') ? item.lastSoldAt : item.lastSoldAt + 'Z').toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' }) : '';

    // Base row (common columns)
    const baseRow = [
      item.id,
      csvEscape(item.name),
      getCategoryLabel(item.category),
      item.price != null ? item.price.toFixed(2) : '',
      item.quantity || 0,
      item.reservedCount || 0,
      item.soldCount || 0,
      csvEscape(item.buyers),
      csvEscape(item.buyerEmails),
      soldDateStr,
      item.isVisible === 0 ? 'Ukryty' : 'Widoczny',
      dateStr,
      item.favoriteCount || 0,
      imageCount,
      mainImage ? `${baseUrl}${mainImage}` : ''
    ];

    // Add extra columns for full version
    if (fullVersion) {
      const allImages = item.images && item.images.length > 0
        ? item.images.map(img => `${baseUrl}${img.imagePath}`).join('|')
        : (item.imagePath ? `${baseUrl}${item.imagePath}` : '');

      return [...baseRow, csvEscape(item.description), allImages];
    }

    return baseRow;
  });

  // Build CSV content with BOM for Excel
  const BOM = '\uFEFF';
  const csvContent = BOM + headers.join(',') + '\n' + rows.map(row => row.join(',')).join('\n');

  // Create and download file
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = fullVersion
    ? `items-full-export-${timestamp}.csv`
    : `items-export-${timestamp}.csv`;
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Event listeners
function setupEventListeners() {
  addItemForm.addEventListener('submit', addItem);
  editItemForm.addEventListener('submit', saveEdit);
  statusFilter.addEventListener('change', renderItems);
  confirmDeleteBtn.addEventListener('click', confirmDelete);

  // Reservations sort - re-render list when changed
  const exportSort = document.getElementById('exportSort');
  if (exportSort) {
    exportSort.addEventListener('change', renderReservations);
  }

  // Show/hide quantity field based on category (Add form)
  document.getElementById('itemCategory').addEventListener('change', function() {
    const quantityGroup = document.getElementById('itemQuantityGroup');
    if (supportsQuantity(this.value)) {
      quantityGroup.style.display = 'block';
    } else {
      quantityGroup.style.display = 'none';
      document.getElementById('itemQuantity').value = '1'; // Reset to 1 for non-supported categories
    }
  });

  // Show/hide quantity field based on category (Edit modal)
  document.getElementById('editItemCategory').addEventListener('change', function() {
    const quantityGroup = document.getElementById('editItemQuantityGroup');
    if (supportsQuantity(this.value)) {
      quantityGroup.style.display = 'block';
    } else {
      quantityGroup.style.display = 'none';
    }
  });

  // Add new images in edit modal
  document.getElementById('editNewImages').addEventListener('change', function(e) {
    addNewImages(e.target.files);
  });

  // Setup admin order modal listeners
  setupAdminOrderListeners();

  // Close modals on outside click
  const adminOrderModal = document.getElementById('adminOrderModal');
  [editModal, deleteModal, historyModal, adminNoteModal, adminOrderModal].forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  });

  // Close modals on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeEditModal();
      closeDeleteModal();
      closeHistoryModal();
      closeAdminNoteModal();
      closeAdminOrderModal();
    }
  });
}

// ---- Admin Manual Order ----

async function openAdminOrderModal() {
  // Load users for dropdown
  let users = [];
  try {
    const response = await fetch('/api/users');
    if (!response.ok) throw new Error('Nie można załadować użytkowników');
    users = await response.json();
  } catch (error) {
    showToast('Błąd ładowania użytkowników: ' + error.message, 'error');
    return;
  }

  // Populate user dropdown
  const userSelect = document.getElementById('adminOrderUser');
  userSelect.innerHTML = '<option value="">Wybierz użytkownika...</option>' +
    users.map(u =>
      `<option value="${u.id}">${escapeHtml(u.displayName)} (${escapeHtml(u.email)})</option>`
    ).join('');

  // Populate item dropdown - only available items with quantity > 0
  const availableItems = items.filter(i => i.quantity > 0 && i.status === 'available');
  const itemSelect = document.getElementById('adminOrderItem');
  itemSelect.innerHTML = '<option value="">Wybierz przedmiot...</option>' +
    availableItems.map(i =>
      `<option value="${i.id}" data-price="${i.price || 0}" data-quantity="${i.quantity}">${escapeHtml(i.name)} (${i.price ? i.price.toFixed(2) + ' zł' : 'brak ceny'}, dost: ${i.quantity})</option>`
    ).join('');

  // Reset form
  document.getElementById('adminOrderQuantity').value = 1;
  document.getElementById('adminOrderDiscountType').value = '';
  document.getElementById('adminOrderDiscountValue').value = '';
  document.getElementById('adminOrderDiscountValue').disabled = true;
  document.getElementById('adminOrderNote').value = '';
  document.getElementById('adminOrderQuantityHint').textContent = 'Dostępne: -';
  document.getElementById('adminOrderPricePreview').style.display = 'none';

  document.getElementById('adminOrderModal').classList.add('active');
}

function closeAdminOrderModal() {
  document.getElementById('adminOrderModal').classList.remove('active');
}

function setupAdminOrderListeners() {
  const itemSelect = document.getElementById('adminOrderItem');
  const discountType = document.getElementById('adminOrderDiscountType');
  const discountValue = document.getElementById('adminOrderDiscountValue');
  const quantityInput = document.getElementById('adminOrderQuantity');

  itemSelect.addEventListener('change', updateAdminOrderPreview);
  discountType.addEventListener('change', () => {
    discountValue.disabled = !discountType.value;
    if (!discountType.value) discountValue.value = '';
    updateAdminOrderPreview();
  });
  discountValue.addEventListener('input', updateAdminOrderPreview);
  quantityInput.addEventListener('input', updateAdminOrderPreview);
}

function updateAdminOrderPreview() {
  const itemSelect = document.getElementById('adminOrderItem');
  const selectedOption = itemSelect.options[itemSelect.selectedIndex];

  if (!selectedOption || !selectedOption.value) {
    document.getElementById('adminOrderPricePreview').style.display = 'none';
    document.getElementById('adminOrderQuantityHint').textContent = 'Dostępne: -';
    return;
  }

  const price = parseFloat(selectedOption.dataset.price) || 0;
  const available = parseInt(selectedOption.dataset.quantity) || 0;
  const quantity = parseInt(document.getElementById('adminOrderQuantity').value) || 1;
  const discountType = document.getElementById('adminOrderDiscountType').value;
  const discountVal = parseFloat(document.getElementById('adminOrderDiscountValue').value) || 0;

  // Update quantity hint and max
  document.getElementById('adminOrderQuantityHint').textContent = `Dostępne: ${available}`;
  document.getElementById('adminOrderQuantity').max = available;

  // Calculate price preview
  let unitPrice = price;
  if (discountType === 'percent') {
    unitPrice = price * (1 - discountVal / 100);
  } else if (discountType === 'fixed') {
    unitPrice = price - discountVal;
  }
  if (unitPrice < 0) unitPrice = 0;
  unitPrice = Math.round(unitPrice * 100) / 100;

  const total = unitPrice * quantity;
  const previewDiv = document.getElementById('adminOrderPricePreview');
  const previewText = document.getElementById('adminOrderPriceText');

  if (price > 0) {
    previewDiv.style.display = 'block';
    let text = `${unitPrice.toFixed(2)} zł/szt.`;
    if (quantity > 1) text += ` × ${quantity} = ${total.toFixed(2)} zł`;
    if (discountType) text += ` (katalogowa: ${price.toFixed(2)} zł)`;
    previewText.textContent = text;
  } else {
    previewDiv.style.display = 'none';
  }
}

async function submitAdminOrder(event) {
  event.preventDefault();

  const userId = document.getElementById('adminOrderUser').value;
  const itemId = document.getElementById('adminOrderItem').value;
  const quantity = document.getElementById('adminOrderQuantity').value;
  const discountType = document.getElementById('adminOrderDiscountType').value;
  const discountValue = document.getElementById('adminOrderDiscountValue').value;
  const adminNote = document.getElementById('adminOrderNote').value;

  if (!userId || !itemId) {
    showToast('Wybierz użytkownika i przedmiot', 'warning');
    return;
  }

  if (!adminNote.trim()) {
    showToast('Notatka admina jest wymagana', 'warning');
    return;
  }

  const payload = { itemId, userId, quantity, adminNote };
  if (discountType && discountValue) {
    payload.discountType = discountType;
    payload.discountValue = discountValue;
  }

  try {
    const response = await fetch('/api/reservations/admin-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Nie udało się utworzyć zamówienia');
    }

    const result = await response.json();
    closeAdminOrderModal();
    showToast(`Utworzono ${result.count} rezerwacji (zamówienie ${result.adminOrderId.substring(0, 8)})`, 'success');
    await Promise.all([loadReservations(), loadItems()]);
  } catch (error) {
    showToast('Błąd: ' + error.message, 'error');
  }
}

// Start app
init();
