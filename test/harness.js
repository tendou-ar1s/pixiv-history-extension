(() => {
  'use strict';
  const out = [];
  let pass = 0, fail = 0, pending = 0;
  let chain = Promise.resolve();
  let done = false;

  function print() {
    const summary = `共 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`;
    document.getElementById('results').textContent = summary + '\n' + out.join('\n');
  }
  function settle() { if (pending === 0 && done && pass + fail > 0) print(); }

  // 异步测试串行执行：上一个测试完全结算后才运行下一个测试体，
  // 避免并发测试间共享可变状态（如 C.storage.backend）的相互干扰。
  window.test = function (name, fn) {
    chain = chain.then(() => {
      try {
        const r = fn();
        if (r && typeof r.then === 'function') {
          pending++;
          return r.then(() => { pass++; out.push(`PASS  ${name}`); },
                        e => { fail++; out.push(`FAIL  ${name}\n      ${e && e.message}`); })
                      .then(() => { pending--; settle(); });
        }
        pass++; out.push(`PASS  ${name}`); settle();
      } catch (e) { fail++; out.push(`FAIL  ${name}\n      ${e && e.message}`); settle(); }
    });
  };

  window.assertEqual = function (actual, expected, msg = '') {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${msg ? msg + ' ' : ''}expected=${e} actual=${a}`);
  };

  window.assertMatches = function (actual, re, msg = '') {
    if (typeof actual !== 'string' || !re.test(actual)) {
      throw new Error(`${msg ? msg + ' ' : ''}expected ${JSON.stringify(actual)} to match ${re}`);
    }
  };

  window.finishTests = function () { done = true; settle(); };
})();
