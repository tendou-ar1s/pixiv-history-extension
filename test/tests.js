(() => {
  'use strict';
  const C = window.PxvCore;

  // ---- 路由匹配 ----
  window.test('matchArtworkPath: 新版无语言前缀', () => {
    window.assertEqual(C.matchArtworkPath('/artworks/123456', ''), '123456');
  });
  window.test('matchArtworkPath: 新版含语言前缀 /en/', () => {
    window.assertEqual(C.matchArtworkPath('/en/artworks/999', ''), '999');
  });
  window.test('matchArtworkPath: 新版含连字符 locale 前缀 /zh-cn/', () => {
    window.assertEqual(C.matchArtworkPath('/zh-cn/artworks/12', ''), '12');
  });
  window.test('matchArtworkPath: 旧版 member_illust.php', () => {
    window.assertEqual(C.matchArtworkPath('/member_illust.php', '?mode=medium&illust_id=777'), '777');
  });
  window.test('matchArtworkPath: 旧版缺 illust_id → null', () => {
    window.assertEqual(C.matchArtworkPath('/member_illust.php', '?mode=medium'), null);
  });
  window.test('matchArtworkPath: 非作品页 → null', () => {
    window.assertEqual(C.matchArtworkPath('/users/123', ''), null);
    window.assertEqual(C.matchArtworkPath('/bookmark.php', ''), null);
    window.assertEqual(C.matchArtworkPath('/artworks/', ''), null);
    window.assertEqual(C.matchArtworkPath('/artworks/abc', ''), null);
  });

  // ---- 元数据提取 ----
  const FAKE_ARTWORK_HTML = `<!DOCTYPE html><html><head>
<meta property="og:title" content="OG兜底标题">
<meta property="og:image" content="https://i.pximg.net/c/250x250/img-master.jpg">
</head><body>
<a href="/users/67890"><img src="a.jpg" alt="山田太郎"></a>
<div><h1>  夜の桜  </h1></div>
<div>
  <a href="/tags/東方/artworks">東方</a>
  <a href="/tags/風景/artworks">風景</a>
  <a href="/tags/東方/artworks">東方</a>
</div>
</body></html>`;

  window.test('extractMetadata: 完整字段提取', () => {
    const doc = new DOMParser().parseFromString(FAKE_ARTWORK_HTML, 'text/html');
    const m = C.extractMetadata(doc);
    window.assertEqual(m.title, '夜の桜');
    window.assertEqual(m.author, '山田太郎');
    window.assertEqual(m.authorId, '67890');
    window.assertEqual(m.thumb, 'https://i.pximg.net/c/250x250/img-master.jpg');
    window.assertEqual(m.tags, ['東方', '風景']);
  });
  window.test('extractMetadata: 无 h1 时 og:title 兜底', () => {
    const html = FAKE_ARTWORK_HTML.replace(/<div><h1>.*?<\/h1><\/div>/, '');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    window.assertEqual(C.extractMetadata(doc).title, 'OG兜底标题');
  });
  window.test('extractMetadata: 空文档全部兜底值', () => {
    const doc = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');
    window.assertEqual(C.extractMetadata(doc),
      { title: null, author: null, authorId: null, thumb: null, tags: [] });
  });
  window.test('extractMetadata: 页头自己的用户链接不遮蔽作品作者', () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<header><a href="/users/11111"><img src="me.jpg" alt="我自己"></a></header>
<main>
<a href="/users/67890"><img src="a.jpg" alt="山田太郎"></a>
<div><h1>夜の桜</h1></div>
</main>
</body></html>`;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const m = C.extractMetadata(doc);
    window.assertEqual(m.author, '山田太郎', '作者应取 main 内的作品作者');
    window.assertEqual(m.authorId, '67890');
  });

  // ---- 合并去重 / 裁剪 ----
  window.test('mergeEntry: 重复访问置顶并更新时间', () => {
    const list = [{ illustId: '3', viewedAt: 3 }, { illustId: '2', viewedAt: 2 }, { illustId: '1', viewedAt: 1 }];
    const next = C.mergeEntry(list, { illustId: '1', viewedAt: 9 });
    window.assertEqual(next.map(e => e.illustId), ['1', '3', '2']);
    window.assertEqual(next[0].viewedAt, 9);
    window.assertEqual(list.length, 3, '原数组不被修改');
  });
  window.test('mergeEntry: 新条目头插', () => {
    const next = C.mergeEntry([{ illustId: 'a', viewedAt: 1 }], { illustId: 'b', viewedAt: 2 });
    window.assertEqual(next.map(e => e.illustId), ['b', 'a']);
  });
  window.test('mergeEntry: 超 1000 条淘汰最旧', () => {
    const list = [];
    for (let i = 1000; i >= 1; i--) list.push({ illustId: String(i), viewedAt: i });
    const next = C.mergeEntry(list, { illustId: '1001', viewedAt: 1001 }, 1000);
    window.assertEqual(next.length, 1000);
    window.assertEqual(next[0].illustId, '1001');
    window.assertEqual(next[next.length - 1].illustId, '2', '最旧的 1 被淘汰');
  });
  window.test('mergeEntry: 恰好 1000 条时不再淘汰', () => {
    const list = [];
    for (let i = 999; i >= 1; i--) list.push({ illustId: String(i), viewedAt: i });
    const next = C.mergeEntry(list, { illustId: '1000', viewedAt: 1000 }, 1000);
    window.assertEqual(next.length, 1000);
    window.assertEqual(next[next.length - 1].illustId, '1', '没有条目被淘汰');
  });
  window.test('mergeEntry: 满 1000 条时重看最旧条不淘汰任何条目', () => {
    const list = [];
    for (let i = 1000; i >= 1; i--) list.push({ illustId: String(i), viewedAt: i });
    const next = C.mergeEntry(list, { illustId: '1', viewedAt: 2000 }, 1000);
    window.assertEqual(next.length, 1000);
    window.assertEqual(next[0].illustId, '1');
    window.assertEqual(next[next.length - 1].illustId, '2', '仅次序前移，无条目被淘汰');
  });

  // ---- 相对时间 ----
  window.test('relativeTime: 各时间分支', () => {
    const now = new Date('2026-06-15T12:00:00').getTime();
    window.assertEqual(C.relativeTime(now - 30 * 1000, now), '刚刚');
    window.assertEqual(C.relativeTime(now - 5 * 60 * 1000, now), '5分钟前');
    window.assertEqual(C.relativeTime(now - 3 * 3600 * 1000, now), '3小时前');
    window.assertMatches(C.relativeTime(now - 24 * 3600 * 1000, now), /^昨天 \d{2}:\d{2}$/);
    window.assertEqual(C.relativeTime(new Date('2026-06-10T08:00:00').getTime(), now), '06-10');
    window.assertEqual(C.relativeTime(new Date('2025-03-05T08:00:00').getTime(), now), '2025-03-05');
  });

  // ---- 去抖门 ----
  window.test('createRecorderGate: 3 秒内同 ID 去抖', () => {
    const g = C.createRecorderGate(3000);
    window.assertEqual(g('1', 1000), true);
    window.assertEqual(g('1', 2000), false);
    window.assertEqual(g('1', 5000), true, '超过窗口再次放行');
    window.assertEqual(g('2', 5001), true, '不同 ID 不受影响');
  });
  window.test('createRecorderGate: 拒绝不延长窗口且边界放行', () => {
    const g = C.createRecorderGate(3000);
    window.assertEqual(g('1', 1000), true);
    window.assertEqual(g('1', 2000), false);
    window.assertEqual(g('1', 3999), false, '被拒访问不重置计时起点');
    window.assertEqual(g('1', 4000), true, 'now-lastTs === windowMs 边界放行');
  });

  // ---- 写队列 ----
  window.test('enqueueWrite: 串行执行', async () => {
    const order = [];
    const p1 = C.enqueueWrite(async () => { await new Promise(r => setTimeout(r, 20)); order.push('a'); });
    const p2 = C.enqueueWrite(async () => { order.push('b'); });
    await p1; await p2;
    window.assertEqual(order, ['a', 'b']);
  });
  window.test('enqueueWrite: 单个写入失败不阻塞后续', async () => {
    const order = [];
    const p1 = C.enqueueWrite(async () => { throw new Error('boom'); });
    const p2 = C.enqueueWrite(async () => { order.push('after'); });
    let err = null;
    try { await p1; } catch (e) { err = e; }
    await p2;
    window.assertMatches(String(err), /boom/, '错误传播给调用方');
    window.assertEqual(order, ['after'], '后续写入仍执行');
  });

  // ---- storage 适配器 ----
  function useFakeStorage() {
    const mem = new Map();
    C.storage.backend = {
      get: async key => (mem.has(key) ? { [key]: mem.get(key) } : {}),
      set: async obj => { for (const [k, v] of Object.entries(obj)) mem.set(k, v); }
    };
    return () => { C.storage.backend = null; };
  }
  window.test('storage: 无后端时 get 返回 fallback', async () => {
    C.storage.backend = null;
    window.assertEqual(await C.storage.get('nothing', 42), 42);
  });
  window.test('storage: 适配器读写往返', async () => {
    const restore = useFakeStorage();
    window.assertEqual(await C.storage.get('foo', []), []);
    await C.storage.set({ foo: [1, 2] });
    window.assertEqual(await C.storage.get('foo', []), [1, 2]);
    restore();
  });

  // ---- 端到端：模拟 recorder.record 完整写入流 ----
  window.test('端到端: 记录→去重置顶→持久化', async () => {
    const restore = useFakeStorage();
    async function record(entry) {
      await C.enqueueWrite(async () => {
        const list = await C.storage.get('pixivHistory', []);
        await C.storage.set({ pixivHistory: C.mergeEntry(list, entry, 1000) });
      });
    }
    await record({ illustId: '10', viewedAt: 1 });
    await record({ illustId: '11', viewedAt: 2 });
    await record({ illustId: '10', viewedAt: 3 });
    const list = await C.storage.get('pixivHistory', []);
    window.assertEqual(list.map(e => e.illustId), ['10', '11']);
    window.assertEqual(list[0].viewedAt, 3);
    restore();
  });

  window.finishTests();
})();
