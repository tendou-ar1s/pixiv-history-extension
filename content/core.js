(() => {
  'use strict';

  const RE_ARTWORK_NEW = /^\/(?:[a-z]{2,3}(?:-[a-z]{2,4})?\/)?artworks\/(\d+)/;
  const RE_ARTWORK_OLD = /^\/member_illust\.php$/;

  function matchArtworkPath(pathname, search) {
    const m = RE_ARTWORK_NEW.exec(pathname || '');
    if (m) return m[1];
    if (RE_ARTWORK_OLD.test(pathname || '') && search) {
      const id = new URLSearchParams(search).get('illust_id');
      if (id && /^\d+$/.test(id)) return id;
    }
    return null;
  }

  function extractMetadata(doc) {
    const out = { title: null, author: null, authorId: null, thumb: null, tags: [] };
    try {
      const t = doc.querySelector('h1') && doc.querySelector('h1').textContent.trim();
      if (t) out.title = t;
    } catch (e) {}
    if (!out.title) {
      try {
        const og = doc.querySelector('meta[property="og:title"]');
        const c = og && og.getAttribute('content');
        if (c && c.trim()) out.title = c.trim();
      } catch (e) {}
    }
    try {
      const link = doc.querySelector('main a[href*="/users/"]')
        || doc.querySelector('a[href*="/users/"]');
      if (link) {
        const img = link.querySelector('img[alt]');
        const alt = img && img.getAttribute('alt');
        if (alt && alt.trim()) out.author = alt.trim();
        else {
          const txt = link.textContent && link.textContent.trim();
          if (txt) out.author = txt;
        }
        const um = /\/users\/(\d+)/.exec(link.getAttribute('href') || '');
        if (um) out.authorId = um[1];
      }
    } catch (e) {}
    try {
      // 优先取页面主图的真实 i.pximg.net URL（与官方页面缩略图同源，
      // "新标签页打开图像"可直接显示）；og:image 可能指向 embed.pixiv.net
      // 的 attachment 响应，直接打开会变成下载，仅作兜底。
      let best = null;
      for (const img of doc.querySelectorAll('img[src*="i.pximg.net/"], img[srcset*="i.pximg.net/"]')) {
        const s = img.getAttribute('src') || '';
        if (/i\.pximg\.net\/(img-master|c\/|img\/)/.test(s) && !/\/(square|custom)\//.test(s)) { best = s; break; }
      }
      if (best) {
        // srcset 常带更大尺寸变体，取最大的 1200Master 或保持 src
        out.thumb = best;
      } else {
        const og = doc.querySelector('meta[property="og:image"]');
        const c = og && og.getAttribute('content');
        if (c) out.thumb = c;
      }
    } catch (e) {}
    try {
      const seen = new Set();
      for (const a of doc.querySelectorAll('a[href*="/tags/"]')) {
        const txt = (a.textContent || '').trim();
        if (txt && !seen.has(txt)) { seen.add(txt); out.tags.push(txt); }
        if (out.tags.length >= 8) break;
      }
    } catch (e) {}
    return out;
  }

  // 契约：list 为新→旧有序数组；entry.illustId 必须为有效字符串（本函数不校验）；
  // cap 为正整数（默认 1000）。返回新数组（浅拷贝，条目对象与入参共享引用），
  // 入参 list 不被修改。超出 cap 时丢弃尾部（最旧）。
  function mergeEntry(list, entry, cap = 1000) {
    const next = list.filter(e => e.illustId !== entry.illustId);
    next.unshift(entry);
    if (next.length > cap) next.length = cap;
    return next;
  }

  function relativeTime(ts, now = Date.now()) {
    const min = 60 * 1000, hour = 60 * min, day = 24 * hour;
    const diff = now - ts;
    if (diff < min) return '刚刚';
    if (diff < hour) return `${Math.floor(diff / min)}分钟前`;
    if (diff < day) return `${Math.floor(diff / hour)}小时前`;
    const d = new Date(ts), n = new Date(now);
    const yest = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(d, yest)) {
      return `昨天 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    if (d.getFullYear() === n.getFullYear()) {
      return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function createRecorderGate(windowMs = 3000) {
    let lastId = null, lastTs = 0;
    return (illustId, now = Date.now()) => {
      if (illustId === lastId && now - lastTs < windowMs) return false;
      lastId = illustId; lastTs = now;
      return true;
    };
  }

  let writeQueue = Promise.resolve();
  function enqueueWrite(fn) {
    const run = writeQueue.then(fn, fn);
    writeQueue = run.catch(() => {});
    return run;
  }

  const storage = {
    backend: (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null,
    async get(key, fallback) {
      if (!this.backend) return fallback;
      const o = await this.backend.get(key);
      return (key in o) ? o[key] : fallback;
    },
    async set(obj) {
      if (!this.backend) return;
      return this.backend.set(obj);
    }
  };

  window.PxvCore = { matchArtworkPath, extractMetadata, mergeEntry, relativeTime, createRecorderGate, enqueueWrite, storage };
})();
