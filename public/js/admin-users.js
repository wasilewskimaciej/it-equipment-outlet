// State
let currentUser = null;
let users = [];

// DOM Elements
const userInfo = document.getElementById('userInfo');
const usersContainer = document.getElementById('usersContainer');

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
  await loadUsers();
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

// Load users
async function loadUsers() {
  try {
    const response = await fetch('/api/users');
    if (!response.ok) throw new Error('Failed to load users');
    users = await response.json();
    renderUsers();
  } catch (error) {
    console.error('Failed to load users:', error);
    usersContainer.innerHTML = '<div class="message error">Nie udało się załadować użytkowników</div>';
  }
}

// Render users
function renderUsers() {
  if (users.length === 0) {
    usersContainer.innerHTML = '<div class="empty-state"><p>Brak użytkowników</p></div>';
    return;
  }

  usersContainer.innerHTML = `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Nazwa</th>
            <th>Email</th>
            <th>Status</th>
            <th>Ostatnie logowanie</th>
            <th>Ostatnia aktywność</th>
            <th>Data rejestracji</th>
            <th>Akcje</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => {
            const isSelf = currentUser && u.id === currentUser.id;
            return `
              <tr>
                <td>${escapeHtml(u.displayName)}</td>
                <td><a href="mailto:${escapeHtml(u.email)}">${escapeHtml(u.email)}</a></td>
                <td>
                  ${u.isAdmin
                    ? '<span class="badge badge-admin">Administrator</span>'
                    : '<span class="badge badge-user">Użytkownik</span>'
                  }
                </td>
                <td>${u.lastLoginAt ? formatDate(u.lastLoginAt) : '<span style="color: var(--text-muted);">Nigdy</span>'}</td>
                <td>${u.lastActivity ? formatDate(u.lastActivity) : '<span style="color: var(--text-muted);">-</span>'}</td>
                <td>${formatDate(u.createdAt)}</td>
                <td>
                  ${!isSelf
                    ? `<button class="btn ${u.isAdmin ? 'btn-danger' : 'btn-primary'} btn-sm"
                        onclick="toggleAdmin('${u.id}', ${!u.isAdmin})" style="margin-right: 0.5rem;">
                        ${u.isAdmin ? 'Odbierz uprawnienia' : 'Nadaj uprawnienia'}
                      </button>
                      <button class="btn btn-danger btn-sm" onclick="deleteUserAccount('${u.id}')">
                        Usuń konto
                      </button>`
                    : '<span style="color: var(--text-muted);">To Ty</span>'
                  }
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// Toggle admin status
async function toggleAdmin(userId, makeAdmin) {
  if (!confirm(`Czy na pewno chcesz ${makeAdmin ? 'nadać uprawnienia administratora' : 'odebrać uprawnienia administratora'} temu użytkownikowi?`)) {
    return;
  }

  try {
    const response = await fetch(`/api/users/${userId}/admin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isAdmin: makeAdmin })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update admin status');
    }

    await loadUsers();
    showToast(makeAdmin ? 'Uprawnienia administratora zostały nadane' : 'Uprawnienia administratora zostały odebrane', 'success');
  } catch (error) {
    showToast('Błąd: ' + error.message, 'error');
  }
}

// Delete user account
async function deleteUserAccount(userId) {
  const user = users.find(u => u.id === userId);
  const displayName = user ? user.displayName : '';
  if (!confirm(`Czy na pewno chcesz USUNĄĆ KONTO użytkownika: ${displayName}?\n\nTa operacja jest nieodwracalna!`)) {
    return;
  }

  // Double confirmation for safety
  if (!confirm('Ostatnie potwierdzenie - czy na pewno usunąć to konto?')) {
    return;
  }

  try {
    const response = await fetch(`/api/users/${userId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete user');
    }

    await loadUsers();
    showToast('Konto użytkownika zostało usunięte', 'success');
  } catch (error) {
    showToast('Błąd: ' + error.message, 'error');
  }
}

// Helper functions
function formatDate(dateStr) {
  const utcDate = dateStr + 'Z';
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

// Start app
init();
