/**
 * BG Reference — Google Drive Image Gallery
 * v3: Multi-select filter + parallel fetch + localStorage cache
 */

// ─── Constants ────────────────────────────────────────────────────────
const DRIVE    = 'https://www.googleapis.com/drive/v3';
const PAGE_SZ  = 1000;                // max per API request
const CACHE_TTL= 6 * 60 * 60 * 1000; // 6 hours
const THUMB_W  = 'w400';             // thumbnail size (smaller = faster)
const LB_W     = 'w1600';            // lightbox size

// ─── State ────────────────────────────────────────────────────────────
const S = {
  folderId:     '',
  apiKey:       '',
  categories:   [],   // [{id, name}]
  images:       [],   // [{id, name, category, categoryId, ratio}]
  filtered:     [],
  selectedCats: new Set(), // multi-select; empty = show all
  lbIndex:      -1,
};

// ─── DOM ──────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const el = {
  navSettings:   $('navSettings'),
  refreshBtn:    $('refreshBtn'),
  catToggleBtn:  $('catToggleBtn'),
  catBadge:      $('catBadge'),
  catChevron:    $('catChevron'),
  catPanel:      $('catPanel'),
  catBackdrop:   $('catBackdrop'),
  catChipsWrap:  $('catChipsWrap'),
  catClearBtn:   $('catClearBtn'),
  catResultCount:$('catResultCount'),
  overlay:       $('overlay'),
  modalX:        $('modalX'),
  modalCancel:   $('modalCancel'),
  modalSave:     $('modalSave'),
  cfgFolder:     $('cfgFolder'),
  cfgKey:        $('cfgKey'),
  toast:         $('toast'),
  stateEmpty:    $('stateEmpty'),
  stateLoading:  $('stateLoading'),
  stateNone:     $('stateNone'),
  stateBtn:      $('stateBtn'),
  clearFilterBtn:$('clearFilterBtn'),
  loadFill:      $('loadFill'),
  loadLabel:     $('loadLabel'),
  masonry:       $('masonry'),
  lb:            $('lb'),
  lbClose:       $('lbClose'),
  lbPrev:        $('lbPrev'),
  lbNext:        $('lbNext'),
  lbImg:         $('lbImg'),
  lbCat:         $('lbCat'),
  lbName:        $('lbName'),
};

// ─── Persist ──────────────────────────────────────────────────────────
function loadCfg() {
  S.folderId = localStorage.getItem('bg_folder') || '';
  S.apiKey   = localStorage.getItem('bg_key')    || '';
}
function saveCfg() {
  localStorage.setItem('bg_folder', S.folderId);
  localStorage.setItem('bg_key',    S.apiKey);
}

// Cache helpers
function cacheKey() { return `bg_cache_${S.folderId}`; }
function saveCache(data) {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify({ ts: Date.now(), data }));
  } catch(e) { /* quota exceeded — ignore */ }
}
function loadCache() {
  try {
    const raw = localStorage.getItem(cacheKey());
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch(e) { return null; }
}
function clearCache() { localStorage.removeItem(cacheKey()); }

// ─── Toast ────────────────────────────────────────────────────────────
let _tt;
function toast(msg) {
  clearTimeout(_tt);
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  _tt = setTimeout(() => el.toast.classList.remove('show'), 2200);
}

// ─── UI State ─────────────────────────────────────────────────────────
function showState(name) {
  el.stateEmpty.style.display    = name === 'empty'   ? 'flex' : 'none';
  el.stateLoading.style.display  = name === 'loading' ? 'flex' : 'none';
  el.stateNone.style.display     = name === 'none'    ? 'flex' : 'none';
  el.masonry.style.display       = name === 'grid'    ? ''     : 'none';
}
function setProgress(pct, label) {
  el.loadFill.style.width = pct + '%';
  if (label) el.loadLabel.textContent = label;
}

// ─── Modal ────────────────────────────────────────────────────────────
function openModal() {
  el.cfgFolder.value = S.folderId;
  el.cfgKey.value    = S.apiKey;
  el.overlay.classList.add('open');
  closeCatPanel();
  setTimeout(() => el.cfgFolder.focus(), 80);
}
function closeModal() { el.overlay.classList.remove('open'); }

// ─── Category Panel ───────────────────────────────────────────────────
function openCatPanel() {
  el.catPanel.classList.add('open');
  el.catBackdrop.classList.add('open');
  el.catToggleBtn.classList.add('open');
  el.catToggleBtn.setAttribute('aria-expanded', 'true');
}
function closeCatPanel() {
  el.catPanel.classList.remove('open');
  el.catBackdrop.classList.remove('open');
  el.catToggleBtn.classList.remove('open');
  el.catToggleBtn.setAttribute('aria-expanded', 'false');
}
function toggleCatPanel() {
  el.catPanel.classList.contains('open') ? closeCatPanel() : openCatPanel();
}

// ─── Drive API ────────────────────────────────────────────────────────
async function driveGet(path, params = {}) {
  const url = new URL(DRIVE + path);
  url.searchParams.set('key', S.apiKey);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString());
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e?.error?.message || `Drive API ${r.status}`);
  }
  return r.json();
}

async function getSubfolders(parentId) {
  const d = await driveGet('/files', {
    q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: 500,
    orderBy: 'name',
  });
  return d.files || [];
}

// Fetch ALL images from one folder (handles pagination)
async function fetchFolderImages(folderId) {
  const all = [];
  let token = '';
  do {
    const params = {
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
      fields: 'nextPageToken,files(id,name,imageMediaMetadata)',
      pageSize: PAGE_SZ,
    };
    if (token) params.pageToken = token;
    const d = await driveGet('/files', params);
    all.push(...(d.files || []));
    token = d.nextPageToken || '';
  } while (token);
  return all;
}

// ─── Load Gallery ─────────────────────────────────────────────────────
async function loadGallery(forceRefresh = false) {
  if (!S.folderId || !S.apiKey) { showState('empty'); return; }

  S.images     = [];
  S.categories = [];
  S.selectedCats.clear();

  // Try cache first (unless forced refresh)
  if (!forceRefresh) {
    const cached = loadCache();
    if (cached) {
      S.categories = cached.categories;
      S.images     = cached.images;
      S.filtered   = [...S.images];
      renderCatPanel();
      showCatControls();
      renderGrid(S.filtered);
      showState('grid');
      toast(`✓ 已从缓存加载 ${S.images.length} 张图片`);
      return;
    }
  }

  showState('loading');
  setProgress(5, '正在连接 Google Drive…');

  try {
    // 1. Get subfolders
    const folders = await getSubfolders(S.folderId);
    const targets = folders.length
      ? folders.map(f => ({ id: f.id, name: f.name }))
      : [{ id: S.folderId, name: '全部' }];
    S.categories = targets;
    setProgress(15, `发现 ${targets.length} 个分类，并行加载中…`);

    // 2. Parallel fetch — all categories at once (much faster than sequential)
    let done = 0;
    const results = await Promise.all(targets.map(async cat => {
      const files = await fetchFolderImages(cat.id);
      done++;
      const pct = 15 + Math.round((done / targets.length) * 80);
      setProgress(pct, `已加载 ${done}/${targets.length} 个分类…`);
      return files.map(f => {
        const m = f.imageMediaMetadata || {};
        return {
          id:         f.id,
          name:       f.name.replace(/\.[^.]+$/, ''),
          category:   cat.name,
          categoryId: cat.id,
          // aspect ratio for CSS padding-top trick (avoids layout shift)
          ratio:      m.width && m.height ? Math.round((m.height / m.width) * 1000) / 10 : 66.7,
        };
      });
    }));

    S.images   = results.flat();
    S.filtered = [...S.images];

    // Save to cache
    saveCache({ categories: S.categories, images: S.images });
    setProgress(100, `完成`);

    renderCatPanel();
    showCatControls();
    renderGrid(S.filtered);
    showState('grid');
    toast(`✓ 已加载 ${S.images.length} 张图片`);

  } catch (err) {
    console.error(err);
    toast(`⚠ ${err.message}`);
    showState('empty');
  }
}

// ─── Category Panel Rendering ─────────────────────────────────────────
function renderCatPanel() {
  el.catChipsWrap.innerHTML = '';

  // "全部" chip
  el.catChipsWrap.appendChild(makeCatChip('all', '全部', S.images.length));

  // Per-category chips
  S.categories.forEach(cat => {
    const count = S.images.filter(i => i.categoryId === cat.id).length;
    el.catChipsWrap.appendChild(makeCatChip(cat.id, cat.name, count));
  });

  updateCatUI();
}

function makeCatChip(catId, label, count) {
  const btn = document.createElement('button');
  btn.className = 'cat-chip';
  btn.dataset.cat = catId;
  btn.innerHTML = `
    <span class="chip-check">
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M1.5 4L3.5 6L6.5 2" stroke="white" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>
    ${esc(label)} <span style="opacity:.45;font-size:11px">${count}</span>
  `;
  btn.addEventListener('click', () => toggleCat(catId));
  return btn;
}

function showCatControls() {
  el.catToggleBtn.style.display = '';
  el.refreshBtn.style.display   = '';
}

// ─── Multi-select Filter Logic ────────────────────────────────────────
function toggleCat(catId) {
  if (catId === 'all') {
    // Clear all → show everything
    S.selectedCats.clear();
  } else {
    if (S.selectedCats.has(catId)) {
      S.selectedCats.delete(catId);
    } else {
      S.selectedCats.add(catId);
    }
  }
  applyFilter();
}

function clearFilter() {
  S.selectedCats.clear();
  applyFilter();
}

function applyFilter() {
  // Compute filtered list
  if (S.selectedCats.size === 0) {
    S.filtered = [...S.images];
  } else {
    S.filtered = S.images.filter(img => S.selectedCats.has(img.categoryId));
  }

  updateCatUI();

  // Animate grid out → render → animate in
  el.masonry.classList.add('animating');
  requestAnimationFrame(() => {
    if (S.filtered.length === 0) {
      showState('none');
    } else {
      renderGrid(S.filtered);
      showState('grid');
      requestAnimationFrame(() => {
        el.masonry.classList.remove('animating');
        el.masonry.classList.add('visible');
        setTimeout(() => el.masonry.classList.remove('visible'), 350);
      });
    }
    el.masonry.classList.remove('animating');
  });
}

function updateCatUI() {
  const count = S.selectedCats.size;
  const hasFilter = count > 0;

  // Badge
  if (hasFilter) {
    el.catBadge.textContent = count;
    el.catBadge.style.display = '';
    el.catToggleBtn.classList.add('has-filter');
  } else {
    el.catBadge.style.display = 'none';
    el.catToggleBtn.classList.remove('has-filter');
  }

  // Result count
  el.catResultCount.textContent = hasFilter
    ? `显示 ${S.filtered.length} / ${S.images.length} 张`
    : `共 ${S.images.length} 张图片`;

  // Chip selected states
  el.catChipsWrap.querySelectorAll('.cat-chip').forEach(chip => {
    const catId = chip.dataset.cat;
    if (catId === 'all') {
      chip.classList.toggle('selected', !hasFilter);
    } else {
      chip.classList.toggle('selected', S.selectedCats.has(catId));
    }
  });
}

// ─── Render Grid ──────────────────────────────────────────────────────
// Lazy load via IntersectionObserver
const observer = new IntersectionObserver(entries => {
  entries.forEach(({ isIntersecting, target }) => {
    if (!isIntersecting) return;
    const img = target.querySelector('.card-img[data-src]');
    if (!img) return;
    img.src = img.dataset.src;
    delete img.dataset.src;
    observer.unobserve(target);
  });
}, { rootMargin: '400px 0px' }); // preload 400px before visible

function renderGrid(images) {
  // Disconnect old observers
  el.masonry.querySelectorAll('.card').forEach(c => observer.unobserve(c));
  el.masonry.innerHTML = '';

  if (!images.length) return;

  const frag = document.createDocumentFragment();
  images.forEach((img, idx) => {
    frag.appendChild(makeCard(img, idx));
  });
  el.masonry.appendChild(frag);

  // Observe all cards
  el.masonry.querySelectorAll('.card').forEach(c => observer.observe(c));
}

function makeCard(img, idx) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.idx = idx;

  const thumbSrc = `https://drive.google.com/thumbnail?id=${img.id}&sz=${THUMB_W}`;
  const ptop     = img.ratio.toFixed(1); // padding-top % = height/width * 100

  card.innerHTML = `
    <div style="position:relative;padding-top:${ptop}%;background:rgba(255,255,255,.04)">
      <img class="card-img"
        data-src="${thumbSrc}"
        alt="${esc(img.name)}"
        style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"
        loading="lazy">
    </div>
    <div class="card-overlay"></div>
    <div class="card-tag">${esc(img.category)}</div>
    <div class="card-actions">
      <button class="card-btn" data-action="dl" data-id="${img.id}" data-name="${esc(img.name)}" title="下载">${iconDl()}</button>
      <button class="card-btn" data-action="cp" data-id="${img.id}" title="复制链接">${iconLink()}</button>
    </div>
  `;

  // Image fade-in
  const imgEl = card.querySelector('.card-img');
  imgEl.addEventListener('load',  () => imgEl.classList.add('visible'));
  imgEl.addEventListener('error', () => { imgEl.classList.add('visible'); imgEl.style.opacity = '.25'; });

  // Lightbox on card click
  card.addEventListener('click', e => {
    if (e.target.closest('.card-btn')) return;
    S.lbIndex = idx;
    openLb();
  });

  // Button actions
  card.querySelectorAll('.card-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      bounce(btn);
      if (btn.dataset.action === 'dl') doDownload(btn.dataset.id, btn.dataset.name);
      if (btn.dataset.action === 'cp') doCopy(btn.dataset.id);
    });
  });

  return card;
}

function bounce(el) {
  el.style.transform = 'scale(0.88)';
  setTimeout(() => { el.style.transform = ''; }, 200);
}

function doDownload(id, name) {
  const a = document.createElement('a');
  a.href = `https://drive.google.com/uc?export=download&id=${id}`;
  a.download = name;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function doCopy(id) {
  const url = `https://drive.google.com/file/d/${id}/view`;
  navigator.clipboard.writeText(url)
    .then(() => toast('🔗 链接已复制到剪贴板'))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('🔗 链接已复制到剪贴板');
    });
}

// ─── Lightbox ─────────────────────────────────────────────────────────
function openLb() {
  const img = S.filtered[S.lbIndex];
  if (!img) return;
  el.lbImg.src = `https://drive.google.com/thumbnail?id=${img.id}&sz=${LB_W}`;
  el.lbImg.alt = img.name;
  el.lbCat.textContent  = img.category;
  el.lbName.textContent = img.name;
  el.lb.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeLb() {
  el.lb.classList.remove('open');
  document.body.style.overflow = '';
}
function lbNav(dir) {
  const n = S.lbIndex + dir;
  if (n < 0 || n >= S.filtered.length) return;
  S.lbIndex = n;
  el.lbImg.style.cssText = 'opacity:0;transform:scale(.95)';
  requestAnimationFrame(() => {
    openLb();
    el.lbImg.style.cssText = 'transition:opacity .2s,transform .2s;opacity:1;transform:scale(1)';
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function iconDl() {
  return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M7 1v8M4 6l3 3 3-3M1.5 11v.5A1 1 0 002.5 12.5h9a1 1 0 001-1V11"
      stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
function iconLink() {
  return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M5.5 8.5a3.2 3.2 0 004.5 0L12 6.5A3.2 3.2 0 007.5 2L6.5 3"
      stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M8.5 5.5a3.2 3.2 0 00-4.5 0L2 7.5A3.2 3.2 0 006.5 12l1-1"
      stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`;
}

// ─── Events ───────────────────────────────────────────────────────────
// Config modal
el.navSettings.addEventListener('click', openModal);
el.stateBtn.addEventListener('click', openModal);
el.modalX.addEventListener('click', closeModal);
el.modalCancel.addEventListener('click', closeModal);
el.overlay.addEventListener('click', e => { if (e.target === el.overlay) closeModal(); });
el.modalSave.addEventListener('click', () => {
  const fid = el.cfgFolder.value.trim();
  const key = el.cfgKey.value.trim();
  if (!fid) { toast('⚠ 请填写文件夹 ID'); return; }
  if (!key) { toast('⚠ 请填写 API Key'); return; }
  S.folderId = fid; S.apiKey = key;
  saveCfg();
  closeModal();
  clearCache();
  loadGallery(true);
});

// Refresh
el.refreshBtn.addEventListener('click', () => {
  clearCache();
  toast('🔄 正在刷新图片列表…');
  loadGallery(true);
});

// Category panel
el.catToggleBtn.addEventListener('click', toggleCatPanel);
el.catBackdrop.addEventListener('click', closeCatPanel);
el.catClearBtn.addEventListener('click', () => { clearFilter(); });
$('clearFilterBtn').addEventListener('click', () => { clearFilter(); });

// Lightbox
el.lbClose.addEventListener('click', closeLb);
el.lbPrev.addEventListener('click', () => lbNav(-1));
el.lbNext.addEventListener('click', () => lbNav(1));
el.lb.addEventListener('click', e => { if (e.target === el.lb) closeLb(); });

// Keyboard
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (el.lb.classList.contains('open'))      { closeLb();      return; }
    if (el.overlay.classList.contains('open')) { closeModal();   return; }
    if (el.catPanel.classList.contains('open')){ closeCatPanel(); return; }
  }
  if (el.lb.classList.contains('open')) {
    if (e.key === 'ArrowLeft')  lbNav(-1);
    if (e.key === 'ArrowRight') lbNav(1);
  }
});

// ─── Init ─────────────────────────────────────────────────────────────
(function init() {
  loadCfg();
  if (S.folderId && S.apiKey) {
    showState('loading');
    setProgress(0, '正在检查缓存…');
    loadGallery();
  } else {
    showState('empty');
  }
})();
