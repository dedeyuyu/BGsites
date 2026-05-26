/**
 * BG Sites — Google Drive Image Gallery
 * Main Application Logic
 */

// ─── State ────────────────────────────────────────────────────────────
const state = {
  folderId: '',
  apiKey: '',
  categories: [],       // [{ id, name, emoji }]
  images: [],           // [{ id, name, category, categoryId, thumbUrl, viewUrl }]
  filtered: [],         // currently visible images
  activeCategory: 'all',
  searchQuery: '',
  lightboxIndex: -1,
  loading: false,
};

// Emoji palette for categories
const EMOJIS = ['🌟','🎨','🌸','🔥','💎','🌈','🎭','🦋','🌙','⚡','🎪','🌺','🍀','🦄','🎯','🌊'];

// ─── DOM refs ─────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const els = {
  configBtn:       $('configBtn'),
  configModal:     $('configModal'),
  modalClose:      $('modalClose'),
  cancelBtn:       $('cancelBtn'),
  saveConfigBtn:   $('saveConfigBtn'),
  folderIdInput:   $('folderIdInput'),
  apiKeyInput:     $('apiKeyInput'),
  openConfigBtn:   $('openConfigBtn'),
  filterTabs:      $('filterTabs'),
  imageGrid:       $('imageGrid'),
  imageCount:      $('imageCount'),
  loadingState:    $('loadingState'),
  emptyState:      $('emptyState'),
  noResultsState:  $('noResultsState'),
  searchInput:     $('searchInput'),
  lightbox:        $('lightbox'),
  lightboxClose:   $('lightboxClose'),
  lightboxPrev:    $('lightboxPrev'),
  lightboxNext:    $('lightboxNext'),
  lightboxImg:     $('lightboxImg'),
  lightboxCategory:$('lightboxCategory'),
  lightboxTitle:   $('lightboxTitle'),
  toast:           $('toast'),
};

// ─── Persistence ──────────────────────────────────────────────────────
function loadConfig() {
  state.folderId = localStorage.getItem('drive_folder_id') || '';
  state.apiKey   = localStorage.getItem('drive_api_key')   || '';
}

function saveConfig() {
  localStorage.setItem('drive_folder_id', state.folderId);
  localStorage.setItem('drive_api_key',   state.apiKey);
}

// ─── Toast ────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
  clearTimeout(toastTimer);
  els.toast.textContent = msg;
  els.toast.className = `toast show ${type}`;
  toastTimer = setTimeout(() => { els.toast.className = 'toast'; }, 3000);
}

// ─── Modal ────────────────────────────────────────────────────────────
function openModal() {
  els.folderIdInput.value = state.folderId;
  els.apiKeyInput.value   = state.apiKey;
  els.configModal.classList.add('open');
}

function closeModal() {
  els.configModal.classList.remove('open');
}

// ─── Google Drive API ─────────────────────────────────────────────────
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const IMG_MIME  = ['image/jpeg','image/png','image/gif','image/webp','image/svg+xml'].join(',');

async function driveRequest(endpoint, params = {}) {
  const url = new URL(DRIVE_API + endpoint);
  url.searchParams.set('key', state.apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function fetchSubfolders(parentId) {
  const data = await driveRequest('/files', {
    q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: 100,
    orderBy: 'name',
  });
  return data.files || [];
}

async function fetchImagesInFolder(folderId) {
  const all = [];
  let pageToken = '';
  do {
    const params = {
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
      fields: 'nextPageToken,files(id,name,mimeType,thumbnailLink,webContentLink,webViewLink)',
      pageSize: 100,
    };
    if (pageToken) params.pageToken = pageToken;
    const data = await driveRequest('/files', params);
    all.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return all;
}

function thumbUrl(file) {
  // Use thumbnailLink if present, else construct from file ID
  if (file.thumbnailLink) return file.thumbnailLink.replace('=s220', '=s400');
  return `https://drive.google.com/thumbnail?id=${file.id}&sz=w400`;
}

function viewUrl(file) {
  return `https://drive.google.com/file/d/${file.id}/view`;
}

// ─── Load Data ────────────────────────────────────────────────────────
async function loadGallery() {
  if (!state.folderId || !state.apiKey) {
    showEmptyState();
    return;
  }

  state.loading = true;
  showLoadingState();
  state.categories = [];
  state.images = [];

  try {
    // 1. Get subfolders (categories)
    const folders = await fetchSubfolders(state.folderId);

    if (folders.length === 0) {
      // No subfolders — load images directly from root
      const files = await fetchImagesInFolder(state.folderId);
      state.categories = [{ id: state.folderId, name: '全部图片', emoji: '🖼️' }];
      state.images = files.map(f => ({
        id: f.id,
        name: f.name.replace(/\.[^.]+$/, ''),
        category: '全部图片',
        categoryId: state.folderId,
        thumbUrl: thumbUrl(f),
        viewUrl: viewUrl(f),
      }));
    } else {
      // 2. Fetch images from each subfolder (category)
      state.categories = folders.map((f, i) => ({
        id: f.id,
        name: f.name,
        emoji: EMOJIS[i % EMOJIS.length],
      }));

      const results = await Promise.allSettled(
        state.categories.map(cat => fetchImagesInFolder(cat.id))
      );

      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          const cat = state.categories[i];
          result.value.forEach(f => {
            state.images.push({
              id: f.id,
              name: f.name.replace(/\.[^.]+$/, ''),
              category: cat.name,
              categoryId: cat.id,
              thumbUrl: thumbUrl(f),
              viewUrl: viewUrl(f),
            });
          });
        }
      });
    }

    state.activeCategory = 'all';
    state.searchQuery = '';
    els.searchInput.value = '';
    renderFilterTabs();
    applyFilters();
    showToast(`✅ 已加载 ${state.images.length} 张图片`, 'success');

  } catch (err) {
    console.error(err);
    showToast(`❌ 加载失败：${err.message}`, 'error');
    showEmptyState();
  } finally {
    state.loading = false;
  }
}

// ─── Filter & Search ──────────────────────────────────────────────────
function applyFilters() {
  const q = state.searchQuery.toLowerCase().trim();
  const cat = state.activeCategory;

  state.filtered = state.images.filter(img => {
    const matchCat  = cat === 'all' || img.categoryId === cat;
    const matchSearch = !q || img.name.toLowerCase().includes(q) || img.category.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  renderGrid();
  updateCount();
}

function updateCount() {
  const total = state.filtered.length;
  els.imageCount.textContent = `${total} 张图片`;
}

// ─── Render ───────────────────────────────────────────────────────────
function renderFilterTabs() {
  // Keep "All" tab, remove old category tabs
  const allTab = $('tab-all');
  // Remove extra tabs
  Array.from(els.filterTabs.querySelectorAll('.filter-tab:not(#tab-all)')).forEach(t => t.remove());

  // Update "All" tab count
  allTab.innerHTML = `<span class="tab-icon">🖼️</span> 全部 <span class="tab-count">${state.images.length}</span>`;

  // Add category tabs
  state.categories.forEach(cat => {
    const count = state.images.filter(i => i.categoryId === cat.id).length;
    const btn = document.createElement('button');
    btn.className = 'filter-tab';
    btn.dataset.category = cat.id;
    btn.id = `tab-${cat.id}`;
    btn.innerHTML = `<span class="tab-icon">${cat.emoji}</span>${cat.name}<span class="tab-count">${count}</span>`;
    btn.addEventListener('click', () => setCategory(cat.id));
    els.filterTabs.appendChild(btn);
  });
}

function setCategory(catId) {
  state.activeCategory = catId;
  els.filterTabs.querySelectorAll('.filter-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.category === catId);
  });
  applyFilters();
}

function renderGrid() {
  els.imageGrid.innerHTML = '';
  hideAllStates();

  if (state.images.length === 0) {
    showEmptyState();
    return;
  }

  if (state.filtered.length === 0) {
    els.noResultsState.style.display = 'flex';
    return;
  }

  els.imageGrid.style.display = 'grid';

  state.filtered.forEach((img, idx) => {
    const card = document.createElement('div');
    card.className = 'image-card';
    card.style.animationDelay = `${Math.min(idx * 40, 400)}ms`;
    card.innerHTML = `
      <div class="card-thumb">
        <div class="card-thumb-loading">
          <div class="spinner" style="width:24px;height:24px;border-width:2px;"></div>
        </div>
        <img src="${img.thumbUrl}" alt="${escHtml(img.name)}" loading="lazy">
        <div class="card-overlay">
          <div class="overlay-eye">
            <svg viewBox="0 0 20 20" fill="none">
              <ellipse cx="10" cy="10" rx="7" ry="4.5" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="10" cy="10" r="2" fill="currentColor"/>
            </svg>
          </div>
        </div>
      </div>
      <div class="card-info">
        <div class="card-category">${escHtml(img.category)}</div>
        <div class="card-name">${escHtml(img.name)}</div>
      </div>
    `;

    // Image load handlers
    const imgEl = card.querySelector('img');
    const loader = card.querySelector('.card-thumb-loading');
    imgEl.addEventListener('load', () => { loader.style.display = 'none'; });
    imgEl.addEventListener('error', () => {
      loader.innerHTML = `<div class="card-thumb-error">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <rect x="4" y="6" width="24" height="20" rx="2" stroke="currentColor" stroke-width="1.5"/>
          <path d="M4 20l6-6 5 6 4-5 7 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span>无法加载</span>
      </div>`;
    });

    card.addEventListener('click', () => openLightbox(idx));
    els.imageGrid.appendChild(card);
  });
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── State Helpers ────────────────────────────────────────────────────
function hideAllStates() {
  els.loadingState.style.display  = 'none';
  els.emptyState.style.display    = 'none';
  els.noResultsState.style.display= 'none';
  els.imageGrid.style.display     = 'none';
}

function showLoadingState() {
  hideAllStates();
  els.loadingState.style.display = 'flex';
}

function showEmptyState() {
  hideAllStates();
  els.emptyState.style.display = 'flex';
}

// ─── Lightbox ─────────────────────────────────────────────────────────
function openLightbox(idx) {
  state.lightboxIndex = idx;
  updateLightbox();
  els.lightbox.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  els.lightbox.classList.remove('open');
  document.body.style.overflow = '';
  state.lightboxIndex = -1;
}

function updateLightbox() {
  const img = state.filtered[state.lightboxIndex];
  if (!img) return;
  els.lightboxImg.src = `https://drive.google.com/thumbnail?id=${img.id}&sz=w1200`;
  els.lightboxImg.alt = img.name;
  els.lightboxCategory.textContent = img.category;
  els.lightboxTitle.textContent = img.name;
}

function lightboxNav(dir) {
  const newIdx = state.lightboxIndex + dir;
  if (newIdx < 0 || newIdx >= state.filtered.length) return;
  state.lightboxIndex = newIdx;
  els.lightboxImg.style.opacity = '0';
  setTimeout(() => {
    updateLightbox();
    els.lightboxImg.style.opacity = '1';
  }, 150);
}

// ─── Event Listeners ──────────────────────────────────────────────────
// Config modal
els.configBtn.addEventListener('click', openModal);
els.openConfigBtn.addEventListener('click', openModal);
els.modalClose.addEventListener('click', closeModal);
els.cancelBtn.addEventListener('click', closeModal);
els.configModal.addEventListener('click', e => { if (e.target === els.configModal) closeModal(); });

els.saveConfigBtn.addEventListener('click', () => {
  const fid = els.folderIdInput.value.trim();
  const key = els.apiKeyInput.value.trim();
  if (!fid) { showToast('请输入文件夹 ID', 'error'); return; }
  if (!key) { showToast('请输入 API Key', 'error'); return; }
  state.folderId = fid;
  state.apiKey = key;
  saveConfig();
  closeModal();
  loadGallery();
});

// Filter tabs — "All" button
$('tab-all').addEventListener('click', () => setCategory('all'));

// Search
let searchTimer;
els.searchInput.addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.searchQuery = e.target.value;
    applyFilters();
  }, 250);
});

// Lightbox
els.lightboxClose.addEventListener('click', closeLightbox);
els.lightboxPrev.addEventListener('click', () => lightboxNav(-1));
els.lightboxNext.addEventListener('click', () => lightboxNav(1));
els.lightbox.addEventListener('click', e => { if (e.target === els.lightbox) closeLightbox(); });

// Keyboard
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (els.lightbox.classList.contains('open')) closeLightbox();
    else if (els.configModal.classList.contains('open')) closeModal();
  }
  if (els.lightbox.classList.contains('open')) {
    if (e.key === 'ArrowLeft')  lightboxNav(-1);
    if (e.key === 'ArrowRight') lightboxNav(1);
  }
});

// ─── Init ─────────────────────────────────────────────────────────────
(function init() {
  loadConfig();
  if (state.folderId && state.apiKey) {
    loadGallery();
  } else {
    showEmptyState();
  }
})();
