(() => {
  'use strict';
  if (window.__pxvPanelLoaded) return; // 防扩展重载/更新时重复注入（与 recorder.js 同约定）
  window.__pxvPanelLoaded = true;

  const C = window.PxvCore;
  if (!C) { console.warn('[pxv-history] core.js 未加载'); return; }

  // ---- 状态 ----
  let cache = [];        // HistoryEntry[]，新→旧
  let open = false;
  let searchTimer = null;
  let toastTimer = null;
  const knownIds = new Set();

  // ---- Shadow DOM 脚手架 ----
  const host = document.createElement('div');
  host.id = 'pxv-history-host';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    .pxv-panel { position:absolute; top:0; right:0; width:360px; height:100%;
      pointer-events:auto; /* host 为 none；此声明覆盖继承，否则整面板不可点击 */
      background:#fff; box-shadow:-4px 0 16px rgba(0,0,0,.15);
      transform:translateX(100%); transition:transform .25s ease;
      display:flex; flex-direction:column; color:#1f1f1f;
      font:14px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif; }
    .pxv-panel.open { transform:none; }
    .pxv-head { display:flex; align-items:center; justify-content:space-between;
      padding:12px 16px; border-bottom:1px solid #eee; }
    .pxv-head h2 { margin:0; font-size:15px; font-weight:600; }
    .pxv-close { border:0; background:none; font-size:18px; cursor:pointer; color:#888; padding:2px 6px; }
    .pxv-close:hover { color:#000; }
    .pxv-banner { display:none; background:#fff4e5; color:#a15c00; font-size:12px; padding:8px 16px; }
    .pxv-banner.show { display:block; }
    .pxv-search { padding:10px 16px; border-bottom:1px solid #eee; }
    .pxv-search input { width:100%; box-sizing:border-box; padding:6px 10px;
      border:1px solid #ddd; border-radius:6px; font-size:13px; outline:none; }
    .pxv-search input:focus { border-color:#0096fa; }
    .pxv-list { flex:1; overflow-y:auto; margin:0; padding:0; list-style:none; }
    .pxv-item { display:flex; gap:10px; padding:10px 16px; cursor:pointer; position:relative; }
    .pxv-item:hover { background:#f5f8ff; }
    .pxv-thumb { width:56px; height:56px; border-radius:8px; object-fit:cover; flex:none; background:#e8e8e8; }
    .pxv-thumb.ph { display:flex; align-items:center; justify-content:center; color:#bbb; font-size:20px; }
    .pxv-meta { min-width:0; display:flex; flex-direction:column; justify-content:center; gap:2px; }
    .pxv-title { font-size:13px; font-weight:600; overflow:hidden; text-overflow:ellipsis;
      display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
    .pxv-sub { font-size:12px; color:#888; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .pxv-del { display:none; position:absolute; top:8px; right:10px; width:22px; height:22px;
      border:0; background:#fff; color:#999; border-radius:4px; cursor:pointer; font-size:14px; line-height:1; }
    .pxv-item:hover .pxv-del { display:block; }
    .pxv-del:hover { color:#e33; background:#fee; }
    .pxv-empty { padding:40px 16px; text-align:center; color:#aaa; font-size:13px; }
    .pxv-foot { display:flex; align-items:center; justify-content:space-between;
      padding:10px 16px; border-top:1px solid #eee; font-size:12px; color:#888; }
    .pxv-clear { border:1px solid #ddd; background:#fff; color:#666; border-radius:6px;
      padding:4px 10px; cursor:pointer; font-size:12px; }
    .pxv-clear:hover { color:#e33; border-color:#e33; }
    .pxv-clear-row input { width:130px; padding:3px 8px; border:1px solid #ddd;
      border-radius:6px; font-size:12px; margin-right:6px; }
    .pxv-clear-row input.err { border-color:#e33; }
    .pxv-cancel { border:0; background:none; color:#0096fa; cursor:pointer; font-size:12px; }
    .pxv-toast { position:absolute; left:50%; transform:translateX(-50%); top:8px;
      background:rgba(0,0,0,.75); color:#fff; font-size:12px; padding:4px 12px;
      border-radius:14px; opacity:0; transition:opacity .3s; pointer-events:none; }
    .pxv-toast.show { opacity:1; }
  `;
  shadow.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'pxv-panel';
  panel.innerHTML = `
    <div class="pxv-head">
      <h2>浏览记录</h2>
      <button class="pxv-close" title="关闭 (Shift+H)">✕</button>
    </div>
    <div class="pxv-banner"></div>
    <div class="pxv-search"><input type="text" placeholder="搜索标题 / 作者"></div>
    <ul class="pxv-list"></ul>
    <div class="pxv-foot">
      <span class="pxv-count"></span>
      <span class="pxv-clear-row"></span>
    </div>
    <div class="pxv-toast"></div>
  `;
  shadow.appendChild(panel);
  document.body.appendChild(host);

  const $ = sel => shadow.querySelector(sel);
  const listEl = $('.pxv-list'), searchEl = $('.pxv-search input'),
        countEl = $('.pxv-count'), clearRow = $('.pxv-clear-row'),
        bannerEl = $('.pxv-banner'), toastEl = $('.pxv-toast');

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---- 渲染 ----
  function renderItem(entry) {
    const li = el('li', 'pxv-item');
    li.dataset.id = entry.illustId;
    if (entry.thumb) {
      const img = document.createElement('img');
      img.className = 'pxv-thumb';
      img.src = entry.thumb;
      img.loading = 'lazy';
      img.alt = '';
      img.onerror = () => { img.remove(); li.prepend(el('div', 'pxv-thumb ph', '▦')); };
      li.appendChild(img);
    } else {
      li.appendChild(el('div', 'pxv-thumb ph', '▦'));
    }
    const meta = el('div', 'pxv-meta');
    meta.appendChild(el('div', 'pxv-title', entry.title || '（未获取到标题）'));
    meta.appendChild(el('div', 'pxv-sub',
      `${entry.author || '未知作者'} · ${C.relativeTime(entry.viewedAt)}`));
    li.appendChild(meta);
    const del = el('button', 'pxv-del', '✕');
    del.title = '删除该条';
    del.addEventListener('click', e => { e.stopPropagation(); removeEntry(entry.illustId); });
    li.appendChild(del);
    li.addEventListener('click', () => { location.assign(entry.url); });
    return li;
  }

  function render() {
    listEl.textContent = '';
    // 过滤在渲染时即时计算，保证 onChanged 删除/新增后视图与 cache 一致
    const kw = searchEl.value.trim().toLowerCase();
    const items = kw
      ? cache.filter(e =>
          (e.title || '').toLowerCase().includes(kw) ||
          (e.author || '').toLowerCase().includes(kw))
      : cache;
    if (!items.length) {
      listEl.appendChild(el('li', 'pxv-empty',
        cache.length ? '没有匹配的记录' : '暂无记录，去 pixiv 逛逛吧'));
    } else {
      const frag = document.createDocumentFragment();
      for (const e of items) frag.appendChild(renderItem(e));
      listEl.appendChild(frag);
    }
    countEl.textContent = `共 ${cache.length} 条`;
  }

  // ---- 数据 ----
  async function load() {
    try {
      cache = await C.storage.get('pixivHistory', []);
      cache.forEach(e => knownIds.add(e.illustId));
    } catch (e) { console.warn('[pxv-history] 记录读取失败', e); cache = []; }
    render();
  }

  async function removeEntry(id) {
    try {
      await C.enqueueWrite(async () => {
        const list = await C.storage.get('pixivHistory', []);
        await C.storage.set({ pixivHistory: list.filter(e => e.illustId !== id) });
      });
    } catch (e) {
      console.warn('[pxv-history] 删除失败', e);
      window.dispatchEvent(new CustomEvent('pxv-history-write-error'));
    }
  }

  async function clearAll() {
    try {
      await C.enqueueWrite(async () => {
        await C.storage.set({ pixivHistory: [] });
      });
    } catch (e) {
      console.warn('[pxv-history] 清空失败', e);
      window.dispatchEvent(new CustomEvent('pxv-history-write-error'));
    }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.pixivHistory) return;
      const prevTop = cache[0] && cache[0].illustId;
      cache = changes.pixivHistory.newValue || [];
      // 先按旧集合统计新增，再从当前 cache 重建 knownIds（同时完成剪枝，
      // 避免删除/清空后旧 ID 永久占位导致复看时不再提示）
      const fresh = cache.filter(e => !knownIds.has(e.illustId)).length;
      knownIds.clear();
      cache.forEach(e => knownIds.add(e.illustId));
      render();
      if (fresh && cache[0] && cache[0].illustId !== prevTop) showToast(`新增 ${fresh} 条记录`);
    });
  } catch (e) { /* onChanged 不可用时静默（面板仍可手动刷新） */ }

  // ---- 搜索（150ms 去抖；过滤在 render 内即时计算） ----
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(render, 150);
  });

  // ---- 清空全部（键入「清空」确认） ----
  function renderClearRow() {
    clearRow.textContent = '';
    const btn = el('button', 'pxv-clear', '清空全部');
    btn.addEventListener('click', () => {
      clearRow.textContent = '';
      const input = el('input');
      input.placeholder = '输入「清空」确认';
      const cancel = el('button', 'pxv-cancel', '取消');
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          if (input.value.trim() === '清空') { clearAll(); renderClearRow(); }
          else { input.classList.add('err'); input.value = ''; }
        } else if (e.key === 'Escape') {
          renderClearRow();
        }
      });
      cancel.addEventListener('click', renderClearRow);
      clearRow.appendChild(input);
      clearRow.appendChild(cancel);
      input.focus();
    });
    clearRow.appendChild(btn);
  }

  // ---- 开合与快捷键 ----
  function setOpen(v) {
    open = v;
    panel.classList.toggle('open', v);
    C.enqueueWrite(() => C.storage.set({ panelState: { open: v } }))
      .catch(e => console.warn('[pxv-history] 面板状态保存失败', e));
    if (v) render();
  }
  $('.pxv-close').addEventListener('click', () => setOpen(false));

  // closed shadow 内部按键会被重定向为 host，window 端无法识别真实 target；
  // 用 shadow 捕获阶段监听拿到未重定向的 e.target，标记来源后由 window 端裁决
  let keyFromPanel = false;
  window.addEventListener('keydown', () => { keyFromPanel = false; }, true);
  shadow.addEventListener('keydown', e => {
    keyFromPanel = true;
    if (!e.shiftKey || (e.key !== 'H' && e.key !== 'h')) return;
    const t = e.target; // shadow 内真实 target（未被重定向）
    const tag = ((t && t.tagName) || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || (t && t.isContentEditable)) return;
    e.stopPropagation(); // 已在内部切换，防止 window 端重复切换
    setOpen(!open);
  }, true);

  window.addEventListener('keydown', e => {
    if (keyFromPanel) return;
    if (!e.shiftKey || (e.key !== 'H' && e.key !== 'h')) return;
    const t = e.target;
    const tag = ((t && t.tagName) || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || (t && t.isContentEditable)) return;
    setOpen(!open);
  });

  // ---- 提示 ----
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
  }

  let bannerTimer = null;
  window.addEventListener('pxv-history-write-error', () => {
    bannerEl.textContent = '存储写入失败，请稍后重试或清空部分记录';
    bannerEl.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => bannerEl.classList.remove('show'), 5000);
  });

  // ---- 初始化 ----
  renderClearRow();
  load().then(async () => {
    const st = await C.storage.get('panelState', { open: false });
    if (st.open) setOpen(true);
  });
})();
