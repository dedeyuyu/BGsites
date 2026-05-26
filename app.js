/**
 * BG Reference — Google Drive Image Gallery
 * Immersive Minimalism Design
 */

// ─── Config ───────────────────────────────────────────────────────────
const DRIVE = 'https://www.googleapis.com/drive/v3';
const BATCH = 200;           // files per API page
const SKELETON_COUNT = 12;   // skeleton cards shown on initial load

// ─── State ────────────────────────────────────────────────────────────
const S = {
  folderId: '',
  apiKey: '',
  categories: [],  // [{id,name}]
  images: [],      // [{id,name,category,categoryId,w,h}]
  filtered: [],
  activeCat: 'all',
  lbIndex: -1,
};

// ─── DOM ──────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const el = {
  nav:         $('nav'),
  navCats:     $('navCats'),
  navSettings: $('navSettings'),
  overlay:     $('overlay'),
  modalX:      $('modalX'),
  modalCancel: $('modalCancel'),
  modalSave:   $('modalSave'),
  cfgFolder:   $('cfgFolder'),
  cfgKey:      $('cfgKey'),
  toast:       $('toast'),
  main:        $('main'),
  stateEmpty:  $('stateEmpty'),
  stateLoading:$('stateLoading'),
  stateNone:   $('stateNone'),
  stateBtn:    $('stateBtn'),
  loadBar:     $('loadBar'),
  loadLabel:   $('loadLabel'),
  masonry:     $('masonry'),
  lb:          $('lb'),
  lbClose:     $('lbClose'),
  lbPrev:      $('lbPrev'),
  lbNext:      $('lbNext'),
  lbImg:       $('lbImg'),
  lbCat:       $('lbCat'),
  lbName:      $('lbName'),
};

// ─── Persistence ──────────────────────────────────────────────────────
function loadCfg() {
  S.folderId = localStorage.getItem('bg_folder') || '';
  S.apiKey   = localStorage.getItem('bg_key')    || '';
}
function saveCfg() {
  localStorage.setItem('bg_folder', S.folderId);
  localStorage.setItem('bg_key',    S.apiKey);
}

// ─── Toast ────────────────────────────────────────────────────────────
let _toastTimer;
function toast(msg) {
  clearTimeout(_toastTimer);
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  _toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2000);
}

// ─── Modal ────────────────────────────────────────────────────────────
function openModal() {
  el.cfgFolder.value = S.folderId;
  el.cfgKey.value    = S.apiKey;
  el.overlay.classList.add('open');
  setTimeout(() => el.cfgFolder.focus(), 100);
}
function closeModal() { el.overlay.classList.remove('open'); }

// ─── States ───────────────────────────────────────────────────────────
function showState(name) {
  el.stateEmpty.style.display   = name === 'empty'   ? 'flex' : 'none';
  el.stateLoading.style.display = name === 'loading' ? 'flex' : 'none';
  el.stateNone.style.display    = name === 'none'    ? 'flex' : 'none';
  el.masonry.style.display      = name === 'grid'    ? ''     : 'none';
}

function setProgress(pct, label) {
  el.loadBar.style.width = pct + '%';
  if (label) el.loadLabel.textContent = label;
}

// ─── Google Drive API ─────────────────────────────────────────────────
async function driveGet(path, params = {}) {
  const url = new URL(DRIVE + path);
  url.searchParams.set('key', S.apiKey);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
  const r = await fetch(url);
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e?.error?.message || `Drive API error ${r.status}`);
  }
  return r.json();
}

async function getSubfolders(parentId) {
  const d = await driveGet('/files', {
    q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: 200,
    orderBy: 'name',
  });
  return d.files || [];
}

async function* streamImages(folderId) {
  let token = '';
  do {
    const params = {
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
      fields: 'nextPageToken,files(id,name,imageMediaMetadata)',
      pageSize: BATCH,
    };
    if (token) params.pageToken = token;
    const d = await driveGet('/files', params);
    yield d.files || [];
    token = d.nextPageToken || '';
  } while (token);
}

// ─── Load Gallery ─────────────────────────────────────────────────────
async function loadGallery() {
  if (!S.folderId || !S.apiKey) { showState('empty'); return; }

  S.images     = [];
  S.categories = [];
  S.activeCat  = 'all';
  showState('loading');
  setProgress(5, '正在连接 Google Drive…');

  try {
    // 1. Subfolders → categories
    const folders = await getSubfolders(S.folderId);
    setProgress(15, `发现 ${folders.length} 个分类…`);

    const targets = folders.length
      ? folders.map(f => ({ id: f.id, name: f.name }))
      : [{ id: S.folderId, name: '全部' }];

    S.categories = targets;

    // 2. Stream images from each category
    let catDone = 0;
    for (const cat of targets) {
      for await (const batch of streamImages(cat.id)) {
        batch.forEach(f => {
          const meta = f.imageMediaMetadata || {};
          S.images.push({
            id:         f.id,
            name:       f.name.replace(/\.[^.]+$/, ''),
            category:   cat.name,
            categoryId: cat.id,
            w:          meta.width  || 0,
            h:          meta.height || 0,
          });
        });
        // Render partial results while loading
        if (S.images.length > 0 && el.masonry.childElementCount === 0) {
          showState('grid');
          renderGrid(S.images, false);
        }
      }
      catDone++;
      const pct = 15 + Math.round((catDone / targets.length) * 80);
      setProgress(pct, `已加载 ${S.images.length} 张图片…`);
    }

    setProgress(100, `完成！共 ${S.images.length} 张图片`);

    S.filtered = [...S.images];
    renderNav();
    renderGrid(S.filtered, true);
    showState('grid');
    toast(`✓ 已加载 ${S.images.length} 张图片`);

  } catch (err) {
    console.error(err);
    toast(`⚠ 加载失败：${err.message}`);
    showState('empty');
  }
}

// ─── Filter ───────────────────────────────────────────────────────────
function filter(catId) {
  S.activeCat = catId;

  // Update active tab
  el.navCats.querySelectorAll('.cat-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === catId);
  });

  S.filtered = catId === 'all'
    ? [...S.images]
    : S.images.filter(i => i.categoryId === catId);

  // Animate grid swap
  el.masonry.classList.add('fade-out');
  setTimeout(() => {
    renderGrid(S.filtered, true);
    el.masonry.classList.remove('fade-out');
    el.masonry.classList.add('fade-in');
    setTimeout(() => el.masonry.classList.remove('fade-in'), 350);
  }, 200);
}

// ─── Render Nav ───────────────────────────────────────────────────────
function renderNav() {
  el.navCats.innerHTML = '';

  const all = makeTabBtn('all', `全部 · ${S.images.length}`);
  all.classList.add('active');
  el.navCats.appendChild(all);

  S.categories.forEach(cat => {
    const count = S.images.filter(i => i.categoryId === cat.id).length;
    el.navCats.appendChild(makeTabBtn(cat.id, `${cat.name} · ${count}`));
  });
}

function makeTabBtn(catId, label) {
  const b = document.createElement('button');
  b.className = 'cat-btn';
  b.dataset.cat = catId;
  b.textContent = label;
  b.addEventListener('click', () => filter(catId));
  return b;
}

// ─── Render Grid ──────────────────────────────────────────────────────
// Lazy load via IntersectionObserver
const imgObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const card = entry.target;
    const imgEl = card.querySelector('.card-img');
    if (!imgEl || imgEl.dataset.loaded) return;
    imgEl.dataset.loaded = '1';
    const src = imgEl.dataset.src;
    imgEl.src = src;
    imgObserver.unobserve(card);
  });
}, { rootMargin: '300px' });

function renderGrid(images, full = true) {
  el.masonry.innerHTML = '';

  if (!images.length) { showState('none'); return; }

  // Show skeleton cards first if full render
  if (full && images.length > SKELETON_COUNT) {
    const skeletonCount = Math.min(SKELETON_COUNT, images.length);
    for (let i = 0; i < skeletonCount; i++) {
      const h = 120 + Math.floor(Math.random() * 160);
      const sk = document.createElement('div');
      sk.className = 'card card-skeleton';
      sk.style.height = h + 'px';
      el.masonry.appendChild(sk);
    }
    // Replace skeletons with real cards after tiny delay
    setTimeout(() => buildCards(images), 50);
  } else {
    buildCards(images);
  }
}

function buildCards(images) {
  el.masonry.innerHTML = '';
  const frag = document.createDocumentFragment();

  images.forEach((img, idx) => {
    const card = createCard(img, idx);
    frag.appendChild(card);
  });

  el.masonry.appendChild(frag);

  // Observe all cards
  el.masonry.querySelectorAll('.card').forEach(c => imgObserver.observe(c));
}

function createCard(img, idx) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.idx = idx;

  // Determine aspect ratio for skeleton placeholder
  const aspectH = img.w && img.h
    ? Math.round((img.h / img.w) * 100)
    : (60 + Math.floor(Math.random() * 60)); // fallback random

  const thumbSrc = `https://drive.google.com/thumbnail?id=${img.id}&sz=w600`;
  const viewSrc  = `https://drive.google.com/thumbnail?id=${img.id}&sz=w1600`;

  card.innerHTML = `
    <div style="position:relative;padding-top:${aspectH}%;">
      <img class="card-img loading"
           data-src="${thumbSrc}"
           alt="${esc(img.name)}"
           style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;"
           loading="lazy">
    </div>
    <div class="card-overlay"></div>
    <div class="card-tag">${esc(img.category)}</div>
    <div class="card-actions">
      <button class="card-btn btn-dl" title="下载" data-id="${img.id}" data-name="${esc(img.name)}">
        ${iconDownload()}
      </button>
      <button class="card-btn btn-cp" title="复制链接" data-id="${img.id}">
        ${iconLink()}
      </button>
    </div>
  `;

  // Image load → fade in
  const imgEl = card.querySelector('.card-img');
  imgEl.addEventListener('load',  () => imgEl.classList.replace('loading','loaded'));
  imgEl.addEventListener('error', () => { imgEl.classList.replace('loading','loaded'); imgEl.style.opacity = '.3'; });

  // Open lightbox on card click (not on buttons)
  card.addEventListener('click', e => {
    if (e.target.closest('.card-btn')) return;
    S.lbIndex = idx;
    openLb();
  });

  // Download
  card.querySelector('.btn-dl').addEventListener('click', e => {
    e.stopPropagation();
    const btn = e.currentTarget;
    btn.style.transform = 'scale(0.88)';
    setTimeout(() => btn.style.transform = '', 200);
    const a = document.createElement('a');
    a.href = `https://drive.google.com/uc?export=download&id=${btn.dataset.id}`;
    a.download = btn.dataset.name;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  // Copy link
  card.querySelector('.btn-cp').addEventListener('click', e => {
    e.stopPropagation();
    const btn = e.currentTarget;
    btn.style.transform = 'scale(0.88)';
    setTimeout(() => btn.style.transform = '', 200);
    const url = `https://drive.google.com/file/d/${btn.dataset.id}/view`;
    navigator.clipboard.writeText(url).then(() => {
      toast('🔗 链接已复制到剪贴板');
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('🔗 链接已复制到剪贴板');
    });
  });

  return card;
}

// ─── Lightbox ─────────────────────────────────────────────────────────
function openLb() {
  const img = S.filtered[S.lbIndex];
  if (!img) return;
  el.lbImg.src = `https://drive.google.com/thumbnail?id=${img.id}&sz=w1600`;
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
  const next = S.lbIndex + dir;
  if (next < 0 || next >= S.filtered.length) return;
  S.lbIndex = next;
  el.lbImg.style.opacity = '0';
  el.lbImg.style.transform = 'scale(.95)';
  setTimeout(() => {
    openLb();
    el.lbImg.style.opacity = '';
    el.lbImg.style.transform = '';
  }, 180);
}

// ─── Helpers ──────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function iconDownload() {
  return `<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <path d="M7.5 1v8M4.5 6l3 3 3-3M2 11v1a1 1 0 001 1h9a1 1 0 001-1v-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function iconLink() {
  return `<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <path d="M6 9a3.5 3.5 0 005 0l2-2a3.5 3.5 0 00-5-4.95l-1 1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M9 6a3.5 3.5 0 00-5 0L2 8a3.5 3.5 0 005 4.95l1-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
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
  S.folderId = fid;
  S.apiKey   = key;
  saveCfg();
  closeModal();
  loadGallery();
});

// Lightbox
el.lbClose.addEventListener('click', closeLb);
el.lbPrev.addEventListener('click',  () => lbNav(-1));
el.lbNext.addEventListener('click',  () => lbNav(1));
el.lb.addEventListener('click', e => { if (e.target === el.lb) closeLb(); });

// Keyboard
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (el.lb.classList.contains('open'))      { closeLb();    return; }
    if (el.overlay.classList.contains('open')) { closeModal(); return; }
  }
  if (el.lb.classList.contains('open')) {
    if (e.key === 'ArrowLeft')  lbNav(-1);
    if (e.key === 'ArrowRight') lbNav(1);
  }
});

// ─── Init ─────────────────────────────────────────────────────────────
(function init() {
  loadCfg();
  showState(S.folderId && S.apiKey ? 'loading' : 'empty');
  if (S.folderId && S.apiKey) loadGallery();
})();
