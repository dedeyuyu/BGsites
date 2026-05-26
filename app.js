/**
 * BG 素材网站 - 内部使用
 * v4: Paginated rendering (no crash) + collapsible category panel + apply button
 */

// ─── Constants ────────────────────────────────────────────────────────
const DRIVE     = 'https://www.googleapis.com/drive/v3';
const PAGE_SZ   = 1000;              // Drive API page size
const RENDER_SZ = 48;               // Cards rendered per batch (prevents crash)
const CACHE_TTL = 6 * 3600 * 1000; // 6h cache
const THUMB     = 'w400';
const LB_THUMB  = 'w1600';

// ─── State ────────────────────────────────────────────────────────────
const S = {
  folderId:     '',
  apiKey:       '',
  categories:   [],   // [{id, name}]
  images:       [],   // all loaded images
  filtered:     [],   // currently displayed subset
  pendingCats:  new Set(), // selected in UI but not yet applied
  appliedCats:  new Set(), // currently applied filter
  renderOffset: 0,
  lbIndex:      -1,
  panelExpanded: false,
};

// ─── DOM ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = {
  navSettings:   $('navSettings'),
  refreshBtn:    $('refreshBtn'),
  catToggleBtn:  $('catToggleBtn'),
  catBtnLabel:   $('catBtnLabel'),
  catBadge:      $('catBadge'),
  catChevron:    $('catChevron'),
  catPanel:      $('catPanel'),
  catBackdrop:   $('catBackdrop'),
  catChipsOuter: $('catChipsOuter'),
  catChipsWrap:  $('catChipsWrap'),
  catExpandBtn:  $('catExpandBtn'),
  catExpandLabel:$('catExpandLabel'),
  catExpandIcon: $('catExpandIcon'),
  catClearBtn:   $('catClearBtn'),
  catApplyBtn:   $('catApplyBtn'),
  catSelInfo:    $('catSelInfo'),
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
  sentinel:      $('sentinel'),
  loadMoreTip:   $('loadMoreTip'),
  lb:            $('lb'),
  lbClose:       $('lbClose'),
  lbPrev:        $('lbPrev'),
  lbNext:        $('lbNext'),
  lbImg:         $('lbImg'),
  lbCat:         $('lbCat'),
  lbName:        $('lbName'),
};

// ─── Config & Cache ───────────────────────────────────────────────────
function loadCfg() {
  S.folderId = localStorage.getItem('bg_folder') || '';
  S.apiKey   = localStorage.getItem('bg_key')    || '';
}
function saveCfg() {
  localStorage.setItem('bg_folder', S.folderId);
  localStorage.setItem('bg_key',    S.apiKey);
}
function cacheKey() { return `bgcache_${S.folderId}`; }
function saveCache(data) {
  try { localStorage.setItem(cacheKey(), JSON.stringify({ ts: Date.now(), data })); } catch(e) {}
}
function loadCache() {
  try {
    const r = localStorage.getItem(cacheKey());
    if (!r) return null;
    const { ts, data } = JSON.parse(r);
    return Date.now() - ts < CACHE_TTL ? data : null;
  } catch(e) { return null; }
}
function clearCache() { localStorage.removeItem(cacheKey()); }

// ─── Toast ────────────────────────────────────────────────────────────
let _tt;
function toast(msg) {
  clearTimeout(_tt);
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  _tt = setTimeout(() => el.toast.classList.remove('show'), 2500);
}

// ─── UI State Machine ─────────────────────────────────────────────────
function showState(name) {
  el.stateEmpty.style.display   = name === 'empty'   ? 'flex'  : 'none';
  el.stateLoading.style.display = name === 'loading' ? 'flex'  : 'none';
  el.stateNone.style.display    = name === 'none'    ? 'flex'  : 'none';
  el.masonry.style.display      = name === 'grid'    ? ''      : 'none';
  el.sentinel.style.display     = name === 'grid'    ? ''      : 'none';
  el.loadMoreTip.style.display  = 'none';
}
function setProgress(pct, label) {
  el.loadFill.style.width = pct + '%';
  if (label) el.loadLabel.textContent = label;
}

// ─── Modal ────────────────────────────────────────────────────────────
function openModal()  { el.cfgFolder.value = S.folderId; el.cfgKey.value = S.apiKey; el.overlay.classList.add('open'); closeCatPanel(); setTimeout(() => el.cfgFolder.focus(), 80); }
function closeModal() { el.overlay.classList.remove('open'); }

// ─── Category Panel ───────────────────────────────────────────────────
function openCatPanel() {
  el.catPanel.classList.add('open');
  el.catBackdrop.classList.add('open');
  el.catToggleBtn.classList.add('open');
  el.catToggleBtn.setAttribute('aria-expanded', 'true');
  // Sync pending to applied so UI matches current filter
  S.pendingCats = new Set(S.appliedCats);
  refreshChipStates();
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

// Expand / collapse chips area
function toggleChipsExpand() {
  S.panelExpanded = !S.panelExpanded;
  el.catChipsWrap.classList.toggle('expanded', S.panelExpanded);
  el.catChipsOuter.classList.toggle('expanded', S.panelExpanded);
  el.catExpandLabel.textContent = S.panelExpanded ? '收起' : '展开全部';
  // Rotate chevron
  el.catExpandIcon.style.transform = S.panelExpanded ? 'rotate(180deg)' : '';
}

// Check if chips overflow their container — show expand btn if so
function checkOverflow() {
  // Small delay to let browser render
  setTimeout(() => {
    const wrap = el.catChipsWrap;
    const hasOverflow = wrap.scrollHeight > wrap.clientHeight + 4;
    if (hasOverflow) {
      el.catExpandBtn.style.display = 'flex';
      el.catChipsOuter.classList.remove('no-overflow');
    } else {
      el.catExpandBtn.style.display = 'none';
      el.catChipsOuter.classList.add('no-overflow');
    }
  }, 80);
}

// ─── Drive API ────────────────────────────────────────────────────────
async function driveGet(path, params = {}) {
  const url = new URL(DRIVE + path);
  url.searchParams.set('key', S.apiKey);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url);
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e?.error?.message || `Drive API ${r.status}`);
  }
  return r.json();
}

async function getSubfolders(parentId) {
  const d = await driveGet('/files', {
    q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)', pageSize: 500, orderBy: 'name',
  });
  return d.files || [];
}

async function fetchFolderImages(folderId) {
  const all = []; let token = '';
  do {
    const p = { q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`, fields: 'nextPageToken,files(id,name,imageMediaMetadata)', pageSize: PAGE_SZ };
    if (token) p.pageToken = token;
    const d = await driveGet('/files', p);
    all.push(...(d.files || []));
    token = d.nextPageToken || '';
  } while (token);
  return all;
}

// ─── Load Gallery ─────────────────────────────────────────────────────
async function loadGallery(forceRefresh = false) {
  if (!S.folderId || !S.apiKey) { showState('empty'); return; }

  S.images = []; S.categories = [];
  S.appliedCats.clear(); S.pendingCats.clear();

  // Try cache
  if (!forceRefresh) {
    const cached = loadCache();
    if (cached) {
      S.categories = cached.categories;
      S.images     = cached.images;
      S.filtered   = [...S.images];
      renderCatPanel();
      showControls();
      renderGrid();
      showState('grid');
      toast(`✓ 已从缓存加载 ${S.images.length} 张图片（6小时内有效）`);
      return;
    }
  }

  showState('loading');
  setProgress(5, '正在连接 Google Drive…');

  try {
    const folders = await getSubfolders(S.folderId);
    const targets = folders.length
      ? folders.map(f => ({ id: f.id, name: f.name }))
      : [{ id: S.folderId, name: '全部' }];
    S.categories = targets;

    setProgress(15, `发现 ${targets.length} 个分类，并行加载中…`);

    // Parallel fetch — all categories simultaneously
    let done = 0;
    const results = await Promise.all(targets.map(async cat => {
      const files = await fetchFolderImages(cat.id);
      done++;
      setProgress(15 + Math.round((done / targets.length) * 80), `${done}/${targets.length} 个分类已加载…`);
      return files.map(f => {
        const m = f.imageMediaMetadata || {};
        return {
          id: f.id,
          name: f.name.replace(/\.[^.]+$/, ''),
          category: cat.name,
          categoryId: cat.id,
          ratio: m.width && m.height ? +(m.height / m.width * 100).toFixed(1) : 66.7,
        };
      });
    }));

    S.images   = results.flat();
    S.filtered = [...S.images];
    saveCache({ categories: S.categories, images: S.images });
    setProgress(100, '完成');

    renderCatPanel();
    showControls();
    renderGrid();
    showState('grid');
    toast(`✓ 加载完成，共 ${S.images.length} 张图片`);

  } catch (err) {
    console.error(err);
    toast(`⚠ ${err.message}`);
    showState('empty');
  }
}

// ─── Category Panel Rendering ─────────────────────────────────────────
function renderCatPanel() {
  el.catChipsWrap.innerHTML = '';
  S.panelExpanded = false;
  el.catChipsWrap.classList.remove('expanded');
  el.catChipsOuter.classList.remove('expanded');

  S.categories.forEach(cat => {
    const count = S.images.filter(i => i.categoryId === cat.id).length;
    const btn = document.createElement('button');
    btn.className = 'cat-chip';
    btn.dataset.cat = cat.id;
    btn.innerHTML = `<span class="cat-chip-dot"></span>${esc(cat.name)}<span style="opacity:.4;font-size:11px;margin-left:2px">${count}</span>`;
    btn.addEventListener('click', () => togglePendingCat(cat.id));
    el.catChipsWrap.appendChild(btn);
  });

  checkOverflow();
  updatePanelInfo();
}

function showControls() {
  el.catToggleBtn.style.display = '';
  el.refreshBtn.style.display   = '';
}

// ─── Pending (pre-apply) Selection ───────────────────────────────────
function togglePendingCat(catId) {
  if (S.pendingCats.has(catId)) {
    S.pendingCats.delete(catId);
  } else {
    S.pendingCats.add(catId);
  }
  refreshChipStates();
  updatePanelInfo();
}

function refreshChipStates() {
  el.catChipsWrap.querySelectorAll('.cat-chip').forEach(chip => {
    chip.classList.toggle('selected', S.pendingCats.has(chip.dataset.cat));
  });
}

function updatePanelInfo() {
  const n = S.pendingCats.size;
  el.catSelInfo.textContent = n > 0 ? `已选 ${n} 个分类` : '未选择（显示全部）';
}

// ─── Apply Filter ─────────────────────────────────────────────────────
function applyFilter() {
  // Commit pending to applied
  S.appliedCats = new Set(S.pendingCats);
  closeCatPanel();

  // Compute filtered
  S.filtered = S.appliedCats.size === 0
    ? [...S.images]
    : S.images.filter(img => S.appliedCats.has(img.categoryId));

  // Update nav button
  const n = S.appliedCats.size;
  if (n > 0) {
    el.catBadge.textContent = n;
    el.catBadge.classList.add('show');
    el.catToggleBtn.classList.add('active');
  } else {
    el.catBadge.classList.remove('show');
    el.catToggleBtn.classList.remove('active');
  }

  if (S.filtered.length === 0) {
    showState('none');
  } else {
    renderGrid();
    showState('grid');
    toast(`显示 ${S.filtered.length} 张图片${n > 0 ? `（${n} 个分类）` : ''}`);
  }
}

function clearFilter() {
  S.pendingCats.clear();
  S.appliedCats.clear();
  S.filtered = [...S.images];
  el.catBadge.classList.remove('show');
  el.catToggleBtn.classList.remove('active');
  refreshChipStates();
  updatePanelInfo();
  closeCatPanel();
  renderGrid();
  showState('grid');
}

// ─── Paginated Grid Rendering ─────────────────────────────────────────
// KEY FIX: Never render all images at once. Render RENDER_SZ at a time.
// Use IntersectionObserver on sentinel to append more as user scrolls.

let imgObserver = null;
let scrollObserver = null;

function setupImgObserver() {
  if (imgObserver) imgObserver.disconnect();
  imgObserver = new IntersectionObserver(entries => {
    entries.forEach(({ isIntersecting, target }) => {
      if (!isIntersecting) return;
      const img = target.querySelector('img[data-src]');
      if (img) { img.src = img.dataset.src; delete img.dataset.src; }
      imgObserver.unobserve(target);
    });
  }, { rootMargin: '500px 0px' });
}

function setupScrollObserver() {
  if (scrollObserver) scrollObserver.disconnect();
  scrollObserver = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    if (S.renderOffset >= S.filtered.length) {
      el.loadMoreTip.style.display = 'none';
      return;
    }
    appendCards();
  }, { rootMargin: '200px' });
  scrollObserver.observe(el.sentinel);
}

function renderGrid() {
  // Full reset
  if (imgObserver)    imgObserver.disconnect();
  if (scrollObserver) scrollObserver.disconnect();
  el.masonry.innerHTML = '';
  S.renderOffset = 0;
  el.loadMoreTip.style.display = 'none';

  setupImgObserver();
  appendCards();          // First batch
  setupScrollObserver();  // Load more on scroll
}

function appendCards() {
  const start = S.renderOffset;
  const end   = Math.min(start + RENDER_SZ, S.filtered.length);
  if (start >= S.filtered.length) return;

  const frag = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    frag.appendChild(makeCard(S.filtered[i], i));
  }
  el.masonry.appendChild(frag);

  // Observe new cards for lazy image loading
  const cards = el.masonry.querySelectorAll('.card:not([data-obs])');
  cards.forEach(c => { c.dataset.obs = '1'; imgObserver.observe(c); });

  S.renderOffset = end;

  // Show/hide "loading more" indicator
  if (S.renderOffset < S.filtered.length) {
    el.loadMoreTip.style.display = 'flex';
  } else {
    el.loadMoreTip.style.display = 'none';
  }
}

// ─── Card Factory ─────────────────────────────────────────────────────
function makeCard(img, idx) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.idx = idx;
  const src = `https://drive.google.com/thumbnail?id=${img.id}&sz=${THUMB}`;

  card.innerHTML = `
    <div style="position:relative;padding-top:${img.ratio}%;background:rgba(255,255,255,.04)">
      <img data-src="${src}" alt="${esc(img.name)}"
        style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"
        loading="lazy">
    </div>
    <div class="card-overlay"></div>
    <div class="card-tag">${esc(img.category)}</div>
    <div class="card-actions">
      <button class="card-btn" data-a="dl" data-id="${img.id}" data-n="${esc(img.name)}" title="下载">${iDl()}</button>
      <button class="card-btn" data-a="cp" data-id="${img.id}" title="复制链接">${iLink()}</button>
    </div>
  `;

  const imgEl = card.querySelector('img');
  imgEl.addEventListener('load',  () => imgEl.classList.add('loaded'));
  imgEl.addEventListener('error', () => { imgEl.classList.add('loaded'); imgEl.style.opacity = '.2'; });

  card.addEventListener('click', e => {
    if (e.target.closest('.card-btn')) return;
    S.lbIndex = idx; openLb();
  });
  card.querySelectorAll('.card-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation(); bounce(btn);
      if (btn.dataset.a === 'dl') doDownload(btn.dataset.id, btn.dataset.n);
      if (btn.dataset.a === 'cp') doCopy(btn.dataset.id);
    });
  });

  return card;
}

function bounce(el) { el.style.transform='scale(.88)'; setTimeout(()=>el.style.transform='',200) }
function doDownload(id, name) {
  const a=document.createElement('a'); a.href=`https://drive.google.com/uc?export=download&id=${id}`; a.download=name; a.target='_blank'; a.rel='noopener'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
function doCopy(id) {
  const url=`https://drive.google.com/file/d/${id}/view`;
  navigator.clipboard.writeText(url).then(()=>toast('🔗 链接已复制到剪贴板')).catch(()=>{
    const ta=document.createElement('textarea'); ta.value=url; ta.style.cssText='position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    toast('🔗 链接已复制到剪贴板');
  });
}

// ─── Lightbox ─────────────────────────────────────────────────────────
function openLb() {
  const img = S.filtered[S.lbIndex]; if (!img) return;
  el.lbImg.src = `https://drive.google.com/thumbnail?id=${img.id}&sz=${LB_THUMB}`;
  el.lbImg.alt = img.name;
  el.lbCat.textContent  = img.category;
  el.lbName.textContent = img.name;
  el.lb.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeLb() { el.lb.classList.remove('open'); document.body.style.overflow = ''; }
function lbNav(dir) {
  const n = S.lbIndex + dir;
  if (n < 0 || n >= S.filtered.length) return;
  S.lbIndex = n;
  el.lbImg.style.cssText = 'opacity:0;transform:scale(.95);transition:none';
  requestAnimationFrame(() => {
    openLb();
    el.lbImg.style.cssText = 'opacity:1;transform:scale(1);transition:opacity .2s,transform .2s';
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function iDl() {
  return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3M1.5 11v.5a1 1 0 001 1h9a1 1 0 001-1V11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function iLink() {
  return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5.5 8.5a3.2 3.2 0 004.5 0L12 6.5A3.2 3.2 0 007.5 2L6.5 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8.5 5.5a3.2 3.2 0 00-4.5 0L2 7.5A3.2 3.2 0 006.5 12l1-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
}

// ─── Events ───────────────────────────────────────────────────────────
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
  S.folderId = fid; S.apiKey = key; saveCfg();
  closeModal(); clearCache(); loadGallery(true);
});

el.refreshBtn.addEventListener('click', () => { clearCache(); toast('🔄 正在刷新…'); loadGallery(true); });

el.catToggleBtn.addEventListener('click', toggleCatPanel);
el.catBackdrop.addEventListener('click', closeCatPanel);
el.catExpandBtn.addEventListener('click', toggleChipsExpand);
el.catClearBtn.addEventListener('click', clearFilter);
el.catApplyBtn.addEventListener('click', applyFilter);
$('clearFilterBtn').addEventListener('click', clearFilter);

el.lbClose.addEventListener('click', closeLb);
el.lbPrev.addEventListener('click', () => lbNav(-1));
el.lbNext.addEventListener('click', () => lbNav(1));
el.lb.addEventListener('click', e => { if (e.target === el.lb) closeLb(); });

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
  if (S.folderId && S.apiKey) { showState('loading'); setProgress(0); loadGallery(); }
  else showState('empty');
})();
