// State
let currentUser = null;
let items = [];
let myReservations = [];
let myFavorites = []; // Array of favorite itemIds
let selectedItemId = null;
let currentImageIndex = 0;
let currentItemImages = [];

// Categories that support quantity field
const QUANTITY_SUPPORTED_CATEGORIES = ['phone', 'monitor'];

// Helper function to check if category supports quantity
function supportsQuantity(category) {
  return QUANTITY_SUPPORTED_CATEGORIES.includes(category);
}

// Pagination state
const PAGE_SIZE = 15;
let totalItems = 0;
let hasMore = false;
let isLoading = false;

// DOM Elements
const userInfo = document.getElementById('userInfo');
const adminLink = document.getElementById('adminLink');
const itemsContainer = document.getElementById('itemsContainer');
const searchInput = document.getElementById('searchInput');
const categoryFilter = document.getElementById('categoryFilter');
const favoritesFilter = document.getElementById('favoritesFilter');
const sortFilter = document.getElementById('sortFilter');
const reserveModal = document.getElementById('reserveModal');
const reserveItemName = document.getElementById('reserveItemName');
const confirmReserveBtn = document.getElementById('confirmReserveBtn');
const myReservationsSection = document.getElementById('myReservationsSection');
const myReservationsContainer = document.getElementById('myReservationsContainer');
const detailsModal = document.getElementById('detailsModal');
const detailsMainImage = document.getElementById('detailsMainImage');
const detailsThumbnails = document.getElementById('detailsThumbnails');
const detailsCategory = document.getElementById('detailsCategory');
const detailsName = document.getElementById('detailsName');
const detailsPrice = document.getElementById('detailsPrice');
const detailsDescription = document.getElementById('detailsDescription');
const detailsReserveBtn = document.getElementById('detailsReserveBtn');
const lightboxModal = document.getElementById('lightboxModal');
const lightboxImage = document.getElementById('lightboxImage');
const lightboxCounter = document.getElementById('lightboxCounter');

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
  await Promise.all([loadItems(), loadMyReservations(), loadMyFavorites()]);
  renderItems(); // Render after all data is loaded
  setupEventListeners();
}

// Load current user
async function loadUser() {
  try {
    const response = await fetch('/auth/me');
    currentUser = await response.json();

    if (currentUser) {
      userInfo.textContent = currentUser.displayName;
      if (currentUser.isAdmin) {
        adminLink.style.display = 'inline-block';
      }
    }
  } catch (error) {
    console.error('Failed to load user:', error);
  }
}

// Load items (initial load with pagination)
async function loadItems() {
  try {
    isLoading = true;
    const sortBy = sortFilter.value || 'newest';
    const category = categoryFilter.value;

    let url = `/api/items?limit=${PAGE_SIZE}&offset=0&sort=${sortBy}`;
    if (category) {
      url += `&category=${encodeURIComponent(category)}`;
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load items');
    const data = await response.json();

    items = data.items;
    totalItems = data.total;
    hasMore = data.hasMore;
  } catch (error) {
    console.error('Failed to load items:', error);
    itemsContainer.innerHTML = '<div class="message error">Nie udało się załadować sprzętu</div>';
  } finally {
    isLoading = false;
  }
}

// Load more items (append to existing)
async function loadMoreItems() {
  if (isLoading || !hasMore) return;

  try {
    isLoading = true;
    updateLoadMoreButton(true);

    const sortBy = sortFilter.value || 'newest';
    const category = categoryFilter.value;

    let url = `/api/items?limit=${PAGE_SIZE}&offset=${items.length}&sort=${sortBy}`;
    if (category) {
      url += `&category=${encodeURIComponent(category)}`;
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load more items');
    const data = await response.json();

    items = [...items, ...data.items];
    hasMore = data.hasMore;

    renderItems();
  } catch (error) {
    console.error('Failed to load more items:', error);
    showToast('Nie udało się załadować więcej produktów', 'error');
  } finally {
    isLoading = false;
    updateLoadMoreButton(false);
  }
}

// Update load more button state
function updateLoadMoreButton(loading) {
  const btn = document.getElementById('loadMoreBtn');
  if (!btn) return;

  if (loading) {
    btn.disabled = true;
    btn.textContent = 'Ładowanie...';
  } else {
    btn.disabled = false;
    btn.textContent = `Pokaż więcej (${items.length}/${totalItems})`;
  }
}

// Load my reservations
async function loadMyReservations() {
  try {
    const response = await fetch('/api/reservations/my');
    if (!response.ok) throw new Error('Failed to load reservations');
    myReservations = await response.json();
    renderMyReservations();
  } catch (error) {
    console.error('Failed to load reservations:', error);
  }
}

// Load my favorite IDs
async function loadMyFavorites() {
  try {
    const response = await fetch('/api/favorites/my/ids');
    if (!response.ok) throw new Error('Failed to load favorites');
    myFavorites = await response.json();
  } catch (error) {
    console.error('Failed to load favorites:', error);
  }
}

// Render my reservations
function renderMyReservations() {
  if (myReservations.length === 0) {
    myReservationsSection.style.display = 'none';
    return;
  }

  myReservationsSection.style.display = 'block';
  myReservationsContainer.innerHTML = `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Sprzęt</th>
            <th>Kategoria</th>
            <th>Data rezerwacji</th>
            <th>Akcje</th>
          </tr>
        </thead>
        <tbody>
          ${myReservations.map(r => `
            <tr>
              <td>${escapeHtml(r.itemName)}</td>
              <td>${getCategoryLabel(r.itemCategory)}</td>
              <td>${formatDate(r.createdAt)}</td>
              <td>
                <button class="btn btn-danger btn-sm" onclick="cancelMyReservation(${r.id})">
                  Anuluj
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <p style="margin-top: 0.5rem; color: #666; font-size: 0.9rem;">
      Skontaktujemy się z Tobą w sprawie odbioru i płatności.
    </p>
  `;
}

// Cancel my reservation
async function cancelMyReservation(id) {
  const reservation = myReservations.find(r => r.id === id);
  const itemName = reservation ? reservation.itemName : '';
  if (!confirm(`Czy na pewno chcesz anulować rezerwację: ${itemName}?`)) {
    return;
  }

  try {
    const response = await fetch(`/api/reservations/my/${id}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to cancel reservation');
    }

    await Promise.all([loadItems(), loadMyReservations()]);
  } catch (error) {
    showToast('Błąd: ' + error.message, 'error');
  }
}

// Render items
function renderItems() {
  const searchTerm = searchInput.value.toLowerCase();
  const category = categoryFilter.value;
  const onlyFavorites = favoritesFilter.checked;
  const sortBy = sortFilter.value;

  const filtered = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm) ||
                          (item.description && item.description.toLowerCase().includes(searchTerm));
    const matchesCategory = !category || item.category === category;
    const matchesFavorites = !onlyFavorites || myFavorites.includes(item.id);
    return matchesSearch && matchesCategory && matchesFavorites;
  });

  if (filtered.length === 0) {
    itemsContainer.innerHTML = `
      <div class="empty-state">
        <h3>Brak dostępnego sprzętu</h3>
        <p>Sprawdź ponownie później lub zmień filtry wyszukiwania.</p>
      </div>
    `;
    return;
  }

  // Sort items
  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'oldest':
        return new Date(a.createdAt) - new Date(b.createdAt);
      case 'price_asc':
        // Items without price go to the end
        if (a.price === null) return 1;
        if (b.price === null) return -1;
        return a.price - b.price;
      case 'price_desc':
        // Items without price go to the end
        if (a.price === null) return 1;
        if (b.price === null) return -1;
        return b.price - a.price;
      case 'newest':
      default:
        return new Date(b.createdAt) - new Date(a.createdAt);
    }
  });

  // Check if filters are active (Load More only works without client-side filters)
  // Category is now server-side, so Load More works with it
  const filtersActive = searchTerm || onlyFavorites;

  const itemsHtml = sorted.map(item => {
    const imageCount = item.images ? item.images.length : (item.imagePath ? 1 : 0);
    // Use thumbnail for catalog view (smaller, faster loading)
    const firstImage = item.images && item.images.length > 0 ? item.images[0] : null;
    const thumbnailImage = firstImage ? (firstImage.thumbnailPath || firstImage.imagePath) : item.imagePath;
    return `
    <div class="item-card" onclick="openDetailsModal(${item.id})">
      <div class="item-image-wrapper">
        ${thumbnailImage
          ? `<img src="${thumbnailImage}" alt="${escapeHtml(item.name)}" class="item-image" loading="lazy">`
          : `<div class="item-image placeholder">📦</div>`
        }
        ${imageCount > 1 ? `<span class="image-count">📷 ${imageCount}</span>` : ''}
        <button
          class="favorite-btn ${myFavorites.includes(item.id) ? 'favorited' : ''}"
          data-favorite-btn="${item.id}"
          onclick="toggleFavorite(${item.id}, event)"
          title="${myFavorites.includes(item.id) ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}"
          aria-label="Toggle favorite">
          ${myFavorites.includes(item.id) ? '♥' : '♡'}
        </button>
      </div>
      <div class="item-content">
        <div class="item-meta">
          <span class="item-category">${getCategoryLabel(item.category)}</span>
          <span class="item-id">ID: ${item.id}</span>
        </div>
        <h3 class="item-name">${escapeHtml(item.name)}</h3>
        ${item.description
          ? `<p class="item-description">${truncateText(item.description, 100)}</p>`
          : ''
        }
        ${supportsQuantity(item.category) && item.quantity > 1
          ? `<p class="item-quantity">Dostępne: <strong>${item.quantity} szt.</strong></p>`
          : ''
        }
        ${item.price
          ? `<div class="item-price">${item.price.toFixed(2)} zł</div>`
          : `<div class="item-price">Cena do uzgodnienia</div>`
        }
        <button class="btn btn-primary" onclick="event.stopPropagation(); openReserveModal(${item.id})">
          Zarezerwuj
        </button>
      </div>
    </div>
  `;
  }).join('');

  // Add Load More button if there are more items and no filters active
  const loadMoreHtml = (!filtersActive && hasMore) ? `
    <div class="load-more-container">
      <button id="loadMoreBtn" class="btn btn-secondary btn-load-more" onclick="loadMoreItems()">
        Pokaż więcej (${items.length}/${totalItems})
      </button>
    </div>
  ` : '';

  itemsContainer.innerHTML = itemsHtml + loadMoreHtml;
}

// Truncate text helper
function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return escapeHtml(text || '');
  return escapeHtml(text.substring(0, maxLength)) + '...';
}

// Category labels
function getCategoryLabel(category) {
  const labels = {
    phone: 'Telefon komórkowy',
    desktop: 'Komputer stacjonarny',
    laptop: 'Laptop',
    monitor: 'Monitor',
    other: 'Inne'
  };
  return labels[category] || escapeHtml(category);
}

// Format date (SQLite stores in UTC, convert to Polish timezone)
function formatDate(dateStr) {
  const utcDate = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z';
  return new Date(utcDate).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
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

// Reserve modal
function openReserveModal(itemId) {
  const item = items.find(i => i.id === itemId);
  selectedItemId = itemId;
  reserveItemName.textContent = item ? item.name : '';
  reserveModal.classList.add('active');
}

function closeReserveModal() {
  selectedItemId = null;
  reserveModal.classList.remove('active');
}

// Details modal - request ID to prevent race conditions
let detailsModalRequestId = 0;

async function openDetailsModal(itemId, fromHash = false) {
  const item = items.find(i => i.id === itemId);
  if (!item) return;

  // Increment request ID to track this specific request
  const thisRequestId = ++detailsModalRequestId;

  selectedItemId = itemId;

  // Update URL hash (only if not triggered by hash change to avoid loop)
  if (!fromHash) {
    window.location.hash = `item-${itemId}`;
  }

  // Build images array (store full objects for thumbnail support)
  if (item.images && item.images.length > 0) {
    currentItemImages = item.images; // Store full objects with thumbnailPath
  } else if (item.imagePath) {
    currentItemImages = [{ imagePath: item.imagePath, thumbnailPath: null }];
  } else {
    currentItemImages = [];
  }
  currentImageIndex = 0;

  // Update modal content
  detailsCategory.textContent = getCategoryLabel(item.category);
  detailsName.textContent = `#${item.id} - ${item.name}`;
  detailsPrice.textContent = item.price ? `${item.price.toFixed(2)} zł` : 'Cena do uzgodnienia';
  detailsDescription.textContent = item.description || 'Brak opisu';

  // Show quantity for categories that support it with quantity > 1
  const quantityContainer = document.getElementById('detailsQuantity');
  const quantityValue = document.getElementById('detailsQuantityValue');
  if (supportsQuantity(item.category) && item.quantity > 1) {
    quantityValue.textContent = item.quantity;
    quantityContainer.style.display = 'block';
  } else {
    quantityContainer.style.display = 'none';
  }

  // Update gallery immediately (before async fetch)
  updateGallery();

  // Show modal immediately (before async fetch)
  detailsModal.classList.add('active');

  // Load and show favorite count (async, but guarded against race conditions)
  const favoriteCountContainer = document.getElementById('detailsFavoriteCount');
  const favoriteCountText = favoriteCountContainer.querySelector('.favorite-count-text');
  try {
    const response = await fetch(`/api/items/${itemId}/favorites/count`);

    // Check if this request is still current (user didn't click another item)
    if (thisRequestId !== detailsModalRequestId) {
      return; // Stale request - ignore response
    }

    if (response.ok) {
      const data = await response.json();

      // Double-check after parsing JSON (another async operation)
      if (thisRequestId !== detailsModalRequestId) {
        return; // Stale request - ignore response
      }

      if (data.count > 0) {
        favoriteCountText.textContent = data.count === 1
          ? '1 osoba polubiła'
          : `${data.count} osób polubiło`;
        favoriteCountContainer.style.display = 'flex';
      } else {
        favoriteCountContainer.style.display = 'none';
      }
    }
  } catch (error) {
    // Only update UI if this is still the current request
    if (thisRequestId === detailsModalRequestId) {
      favoriteCountContainer.style.display = 'none';
    }
  }
}

function closeDetailsModal() {
  detailsModal.classList.remove('active');
  selectedItemId = null;
  currentItemImages = [];
  currentImageIndex = 0;

  // Remove hash from URL
  if (window.location.hash.startsWith('#item-')) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

function updateGallery() {
  if (currentItemImages.length === 0) {
    detailsMainImage.style.display = 'none';
    detailsThumbnails.innerHTML = '';
    document.querySelector('.gallery-prev').style.display = 'none';
    document.querySelector('.gallery-next').style.display = 'none';
    return;
  }

  detailsMainImage.style.display = 'block';
  // Use full imagePath for main image
  detailsMainImage.src = currentItemImages[currentImageIndex].imagePath;
  detailsMainImage.alt = detailsName.textContent;

  // Show/hide navigation buttons
  const showNav = currentItemImages.length > 1;
  document.querySelector('.gallery-prev').style.display = showNav ? 'block' : 'none';
  document.querySelector('.gallery-next').style.display = showNav ? 'block' : 'none';

  // Render thumbnails (use thumbnailPath for smaller file size)
  if (currentItemImages.length > 1) {
    detailsThumbnails.innerHTML = currentItemImages.map((img, idx) => `
      <img src="${img.thumbnailPath || img.imagePath}" alt="Miniatura ${idx + 1}"
           class="gallery-thumb ${idx === currentImageIndex ? 'active' : ''}"
           onclick="selectImage(${idx})">
    `).join('');
  } else {
    detailsThumbnails.innerHTML = '';
  }
}

function selectImage(index) {
  currentImageIndex = index;
  updateGallery();
}

function prevImage() {
  if (currentItemImages.length === 0) return;
  currentImageIndex = (currentImageIndex - 1 + currentItemImages.length) % currentItemImages.length;
  updateGallery();
}

function nextImage() {
  if (currentItemImages.length === 0) return;
  currentImageIndex = (currentImageIndex + 1) % currentItemImages.length;
  updateGallery();
}

function reserveFromDetails() {
  if (!selectedItemId) return;
  const item = items.find(i => i.id === selectedItemId);
  if (!item) return;

  // Save id before closing modal (which resets selectedItemId)
  const itemId = selectedItemId;

  closeDetailsModal();
  openReserveModal(itemId);
}

// Lightbox functions
function openLightbox() {
  if (currentItemImages.length === 0) return;
  lightboxImage.src = currentItemImages[currentImageIndex].imagePath;
  updateLightboxCounter();
  lightboxModal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  lightboxModal.classList.remove('active');
  document.body.style.overflow = '';
}

function updateLightboxCounter() {
  if (currentItemImages.length > 1) {
    lightboxCounter.textContent = `${currentImageIndex + 1} / ${currentItemImages.length}`;
    lightboxCounter.style.display = 'block';
  } else {
    lightboxCounter.style.display = 'none';
  }
}

function lightboxPrev() {
  if (currentItemImages.length === 0) return;
  currentImageIndex = (currentImageIndex - 1 + currentItemImages.length) % currentItemImages.length;
  lightboxImage.src = currentItemImages[currentImageIndex].imagePath;
  updateLightboxCounter();
  updateGallery();
}

function lightboxNext() {
  if (currentItemImages.length === 0) return;
  currentImageIndex = (currentImageIndex + 1) % currentItemImages.length;
  lightboxImage.src = currentItemImages[currentImageIndex].imagePath;
  updateLightboxCounter();
  updateGallery();
}

// Confirm reservation
async function confirmReservation() {
  if (!selectedItemId) return;

  confirmReserveBtn.disabled = true;
  confirmReserveBtn.textContent = 'Rezerwowanie...';

  try {
    const response = await fetch('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: selectedItemId })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Reservation failed');
    }

    closeReserveModal();
    showToast('Rezerwacja została przyjęta! Skontaktujemy się z Tobą wkrótce.', 'success', 5000);
    await Promise.all([loadItems(), loadMyReservations()]);

  } catch (error) {
    showToast('Błąd: ' + error.message, 'error');
  } finally {
    confirmReserveBtn.disabled = false;
    confirmReserveBtn.textContent = 'Zarezerwuj';
  }
}

// Event listeners
function setupEventListeners() {
  searchInput.addEventListener('input', renderItems);
  categoryFilter.addEventListener('change', async () => {
    // Reload items from backend with new category filter
    items = [];
    await loadItems();
    renderItems();
  });
  favoritesFilter.addEventListener('change', renderItems);
  sortFilter.addEventListener('change', async () => {
    // Reload items from backend with new sort order
    await loadItems();
    renderItems();
  });
  confirmReserveBtn.addEventListener('click', confirmReservation);
  detailsReserveBtn.addEventListener('click', reserveFromDetails);

  // Hash routing for deep linking
  window.addEventListener('hashchange', handleHashChange);
  // Handle initial hash on page load
  handleHashChange();

  // Close modals on outside click
  reserveModal.addEventListener('click', (e) => {
    if (e.target === reserveModal) {
      closeReserveModal();
    }
  });

  detailsModal.addEventListener('click', (e) => {
    if (e.target === detailsModal) {
      closeDetailsModal();
    }
  });

  // Close lightbox on outside click
  lightboxModal.addEventListener('click', (e) => {
    if (e.target === lightboxModal || e.target === lightboxImage) {
      // Click on image or background closes lightbox
      if (e.target === lightboxModal) {
        closeLightbox();
      }
    }
  });

  // Close modals on Escape, handle arrow keys for gallery/lightbox
  document.addEventListener('keydown', (e) => {
    // Lightbox takes priority
    if (lightboxModal.classList.contains('active')) {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') lightboxPrev();
      if (e.key === 'ArrowRight') lightboxNext();
      return;
    }

    if (e.key === 'Escape') {
      closeReserveModal();
      closeDetailsModal();
    }
    if (detailsModal.classList.contains('active')) {
      if (e.key === 'ArrowLeft') prevImage();
      if (e.key === 'ArrowRight') nextImage();
    }
  });
}

// Toggle favorite status (dodaj/usuń z ulubionych)
async function toggleFavorite(itemId, event) {
  if (event) {
    event.stopPropagation(); // Nie otwieraj details modal
  }

  const isFav = myFavorites.includes(itemId);
  const button = document.querySelector(`[data-favorite-btn="${itemId}"]`);

  if (!button) return;

  // Optimistic UI update
  button.disabled = true;

  try {
    if (isFav) {
      // Usuń z ulubionych
      const response = await fetch(`/api/favorites/${itemId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to remove favorite');
      }

      myFavorites = myFavorites.filter(id => id !== itemId);
      updateFavoriteButton(itemId, false);

    } else {
      // Dodaj do ulubionych
      const response = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId })
      });

      if (!response.ok) {
        throw new Error('Failed to add favorite');
      }

      myFavorites.push(itemId);
      updateFavoriteButton(itemId, true);
    }

  } catch (error) {
    showToast('Błąd: ' + error.message, 'error');
    // Revert optimistic update
    renderItems();
  } finally {
    button.disabled = false;
  }
}

// Aktualizuj wygląd przycisku favorite
function updateFavoriteButton(itemId, isFavorited) {
  const button = document.querySelector(`[data-favorite-btn="${itemId}"]`);
  if (!button) return;

  if (isFavorited) {
    button.innerHTML = '♥'; // Pełne serduszko
    button.classList.add('favorited');
    button.title = 'Usuń z ulubionych';
  } else {
    button.innerHTML = '♡'; // Puste serduszko
    button.classList.remove('favorited');
    button.title = 'Dodaj do ulubionych';
  }
}

// Hash routing handler - request ID to prevent race conditions
let hashChangeRequestId = 0;

async function handleHashChange() {
  const hash = window.location.hash;

  // Parse #item-123 format
  const match = hash.match(/^#item-(\d+)$/);

  if (match) {
    const itemId = parseInt(match[1], 10);
    const thisRequestId = ++hashChangeRequestId;

    // Check if item exists in loaded items
    let item = items.find(i => i.id === itemId);

    if (!item) {
      // Item not in loaded items - try fetching directly from API
      try {
        const response = await fetch(`/api/items/${itemId}`);

        // Check if hash changed during fetch (user clicked another item)
        if (thisRequestId !== hashChangeRequestId) {
          return; // Stale request - ignore
        }

        if (response.ok) {
          const fetchedItem = await response.json();

          // Double-check after parsing JSON
          if (thisRequestId !== hashChangeRequestId) {
            return; // Stale request - ignore
          }

          // Add to items array so modal can use it
          items.push(fetchedItem);
          item = fetchedItem;
        }
      } catch (error) {
        console.error('Failed to fetch item for deep link:', error);
      }
    }

    // Final check before opening modal
    if (thisRequestId !== hashChangeRequestId) {
      return; // Stale request - ignore
    }

    if (item && !detailsModal.classList.contains('active')) {
      // Open modal with fromHash=true to prevent loop
      openDetailsModal(itemId, true);
    } else if (!item) {
      // Item truly doesn't exist - remove invalid hash
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  } else if (!hash && detailsModal.classList.contains('active')) {
    // Hash removed (back button) - close modal
    detailsModal.classList.remove('active');
    selectedItemId = null;
    currentItemImages = [];
    currentImageIndex = 0;
  }
}

// Start app
init();
