(() => {
  'use strict';
  if (window.__pxvRecorderLoaded) return; // 防扩展重载/更新时重复注入
  window.__pxvRecorderLoaded = true;
  const C = window.PxvCore;
  if (!C) { console.warn('[pxv-history] core.js 未加载'); return; }

  // ---- SPA 路由事件 ----
  const ROUTE_EVENT = 'pxv-route-change';
  const _push = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState = function (...args) { const r = _push(...args); fire(); return r; };
  history.replaceState = function (...args) { const r = _replace(...args); fire(); return r; };
  window.addEventListener('popstate', fire);
  function fire() {
    try { window.dispatchEvent(new CustomEvent(ROUTE_EVENT)); }
    catch (e) { console.warn('[pxv-history] route listener error', e); }
  }

  // ---- 记录流水线 ----
  const gate = C.createRecorderGate(3000);
  let waitToken = 0;

  function handleRoute() {
    ++waitToken; // 任何路由变化都使旧的渲染等待失效（含跳往非作品页）
    let url;
    try { url = new URL(location.href); } catch (e) { return; }
    const illustId = C.matchArtworkPath(url.pathname, url.search);
    if (!illustId) return;
    if (!gate(illustId)) return;
    waitForDom(illustId, waitToken);
  }

  function waitForDom(illustId, token) {
    const started = Date.now();
    let settled = false;
    let timer = null;
    const mo = new MutationObserver(() => {
      // SPA 站内跳转后 DOM 仍是上一页内容，等一小段再取，避免读到旧元数据
      clearTimeout(timer);
      timer = setTimeout(() => { mo.disconnect(); tryOnce(); }, 150);
    });
    const tryOnce = () => {
      if (settled || token !== waitToken) { mo.disconnect(); clearTimeout(fallback); return; }
      const meta = C.extractMetadata(document);
      // 主图 <img>（i.pximg.net）通常晚于标题/作者挂载；等它出现才落盘，
      // 否则封面会回落到 og:image（embed.pixiv.net，右键新标签页打开会变下载）
      const ready = meta.title && meta.author && meta.thumb;
      if (ready || Date.now() - started > 8000) {
        settle(); record(illustId, meta);
        return;
      }
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    };
    function settle() {
      settled = true;
      mo.disconnect();
      clearTimeout(timer);
      clearTimeout(fallback);
    }
    // 兜底：即使再无 DOM 变动，8 秒后也结束等待（降级落盘）。
    // 必须独立于防抖 timer：观察器回调会 clearTimeout(timer)，若与兜底共用
    // 一个句柄，首个 DOM 变动（如 content script 自身注入面板宿主）就会清掉
    // 兜底，元数据始终不全的静态页面将永久滞留、永不降级落盘
    // （Task 10 真机验收实测缺陷：8 秒后仍无记录，任意一次变动才触发）。
    const fallback = setTimeout(() => { tryOnce(); }, 8000);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  }

  async function record(illustId, meta) {
    const entry = {
      illustId,
      url: location.origin + '/artworks/' + illustId,
      title: meta.title,
      author: meta.author,
      authorId: meta.authorId,
      thumb: meta.thumb,
      tags: meta.tags,
      viewedAt: Date.now()
    };
    try {
      await C.enqueueWrite(async () => {
        const list = await C.storage.get('pixivHistory', []);
        await C.storage.set({ pixivHistory: C.mergeEntry(list, entry, 1000) });
      });
    } catch (e) {
      console.warn('[pxv-history] 存储写入失败', e);
      window.dispatchEvent(new CustomEvent('pxv-history-write-error'));
    }
  }

  window.addEventListener(ROUTE_EVENT, handleRoute);
  handleRoute(); // 初始加载（直链打开作品页，SSR DOM 已就绪，tryOnce 立即判定）
})();
