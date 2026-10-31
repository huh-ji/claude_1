'use strict';
// 새 편집 기능 테스트: 빠른 색상, '>' 토글, Tab 들여넣기, 붙여넣기 서식 유지. 실행: npm test
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const QUICK = [
  { type: 'text', color: '#e03131', name: '빨간 글자' },
  { type: 'text', color: '#1971c2', name: '파란 글자' },
  { type: 'bg', color: '#ffec99', name: '노란 배경' },
];

async function openNote(browser, content) {
  const page = await browser.newPage({ viewport: { width: 380, height: 520 } });
  await page.addInitScript(([content, quick]) => {
    window.memo = {
      getState: async () => ({ content, pinned: true, collapsed: false, settings: {}, quickColors: quick, platform: 'test' }),
      saveContent: () => {}, newNote: () => {}, deleteNote: async () => false, setSettings: () => {},
      setPinned: () => {}, setCollapsed: () => {}, getBounds: async () => null, setBounds: () => {},
      minimize: () => {}, close: () => {},
      showMoreMenu: (pos) => { window.__more = pos; },
      openOptions: (tab) => { window.__options = tab; },
      onQuickColors: (cb) => { window.__pushQuick = cb; },
      onApplyQuickColor: (cb) => { window.__menuQuick = cb; },
    };
  }, [content, QUICK]);
  await page.goto('file://' + path.resolve(__dirname, '../src/index.html'));
  await page.waitForFunction(() => window.__memoTest);
  await page.waitForTimeout(100);
  return page;
}

// 편집 영역 안 글자를 찾아 선택 (start~end) 하거나 캐럿을 둔다
async function select(page, text, from = 0, to = null) {
  await page.evaluate(([text, from, to]) => {
    const ed = document.getElementById('editor');
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) if (n.nodeValue.includes(text)) break;
    if (!n) throw new Error('text not found: ' + text);
    const base = n.nodeValue.indexOf(text);
    ed.focus();
    const r = document.createRange();
    r.setStart(n, base + from);
    r.setEnd(n, base + (to == null ? from : to));
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }, [text, from, to]);
}

async function paste(page, data) {
  await page.evaluate((data) => {
    const dt = new DataTransfer();
    Object.entries(data).forEach(([k, v]) => dt.setData(k, v));
    document.getElementById('editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, data);
}

const html = (page) => page.innerHTML('#editor');
const structure = (page) => page.evaluate(() => {
  const walk = (container) => Array.from(container.children).map((el) => (el.classList.contains('toggle')
    ? { toggle: el.querySelector(':scope > .toggle-title').textContent, open: el.dataset.open, body: walk(el.querySelector(':scope > .toggle-body')) }
    : el.textContent));
  return walk(document.getElementById('editor'));
});

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const test = async (name, fn) => {
    try { await fn(); results.push('ok   ' + name); } catch (e) { results.push('FAIL ' + name + '\n     ' + e.message); }
  };

  await test('Ctrl+1 / Ctrl+3 빠른 색상, Ctrl+\\ 서식 지우기', async () => {
    const p = await openNote(browser, '<div>빨강 노랑</div>');
    await select(p, '빨강', 0, 2);
    await p.keyboard.press('Control+1');
    assert.match(await html(p), /<span style="color: rgb\(224, 49, 49\);">빨강<\/span>/, await html(p));
    await select(p, '노랑', 0, 2);
    await p.keyboard.press('Control+3');
    assert.match(await html(p), /background-color: rgb\(255, 236, 153\);">노랑/, await html(p));
    await select(p, '빨강', 0, 2);
    await p.keyboard.press('Control+b');
    await p.keyboard.press('Control+Backslash');
    assert.ok(!/224, 49, 49|<b>/.test(await html(p)), '서식 지우기: ' + await html(p));
    await p.close();
  });

  await test('빠른 색상 목록이 바뀌면 단축키 색도 바뀜 + ⋯ 메뉴에서 적용', async () => {
    const p = await openNote(browser, '<div>가나다</div>');
    await p.evaluate(() => window.__pushQuick([{ type: 'text', color: '#7048e8', name: '보라' }]));
    await select(p, '가나', 0, 2);
    await p.keyboard.press('Control+1');
    assert.match(await html(p), /color: rgb\(112, 72, 232\)/, await html(p));
    await p.keyboard.press('Control+2'); // 없는 번호는 무시
    await select(p, '다', 0, 1);
    await p.click('#btn-more');
    assert.ok(await p.evaluate(() => window.__more && typeof window.__more.x === 'number'), '⋯ 메뉴 요청');
    await p.evaluate(() => window.__menuQuick(0)); // 메뉴에서 '보라' 클릭
    // 같은 색의 이웃한 글자는 Chromium 이 한 span 으로 합친다
    const purple = await p.$$eval('#editor span', (ss) => ss.filter((s) => s.style.color === 'rgb(112, 72, 232)').map((s) => s.textContent).join(''));
    assert.strictEqual(purple, '가나다', await html(p));
    await p.close();
  });

  await test('같은 색을 연속으로 칠해도 매번 적용 (팔레트)', async () => {
    const p = await openNote(browser, '<div>하나 둘</div>');
    for (const word of ['하나', '둘']) {
      await select(p, word, 0, word.length);
      await p.click('#btn-color');
      await p.click('.pal-row[data-kind="text"] .swatch[title^="빨강"]');
    }
    const spans = await p.$$eval('#editor span', (ss) => ss.filter((s) => s.style.color === 'rgb(224, 49, 49)').map((s) => s.textContent));
    assert.deepStrictEqual(spans, ['하나', '둘']);
    await p.close();
  });

  await test("'> ' 와 '>' + Tab 으로 토글 (뒤의 글은 제목, 서식 유지)", async () => {
    const p = await openNote(browser, '<div><br></div><div><b>회의</b> 메모</div>');
    await select(p, '회의', 0); // '회의' 앞에 캐럿
    await p.keyboard.type('> ');
    let st = await structure(p);
    assert.deepStrictEqual(st[1], { toggle: '회의 메모', open: 'true', body: [''] }, JSON.stringify(st));
    assert.ok((await html(p)).includes('<div class="toggle-title"><b>회의</b> 메모</div>'), '제목 서식 유지: ' + await html(p));
    // 캐럿이 제목 맨 앞에 있어야 함
    await p.keyboard.type('★');
    assert.strictEqual((await structure(p))[1].toggle, '★회의 메모');
    // 빈 줄에서 '>' + Tab
    await p.click('#editor');
    await p.keyboard.press('Control+Home');
    await p.keyboard.type('>');
    await p.keyboard.press('Tab');
    await p.keyboard.type('할 일');
    st = await structure(p);
    assert.deepStrictEqual(st[0], { toggle: '할 일', open: 'true', body: [''] }, JSON.stringify(st));
    await p.close();
  });

  await test('토글 아래 줄에서 Tab → 토글 안으로, Shift+Tab → 밖으로', async () => {
    const p = await openNote(browser,
      '<div class="toggle" data-open="false"><span class="toggle-arrow" contenteditable="false"></span><div class="toggle-title">회의</div><div class="toggle-body"><div>안건1</div></div></div><div>안건2</div><div>다른 글</div>');
    await select(p, '안건2', 3);
    await p.keyboard.press('Tab');
    let st = await structure(p);
    assert.deepStrictEqual(st, [{ toggle: '회의', open: 'true', body: ['안건1', '안건2'] }, '다른 글'], JSON.stringify(st));
    await p.keyboard.type('!'); // 캐럿이 옮겨진 줄 끝에 그대로 있어야 함
    st = await structure(p);
    assert.deepStrictEqual(st[0].body, ['안건1', '안건2!']);
    await p.keyboard.press('Shift+Tab');
    st = await structure(p);
    assert.deepStrictEqual(st, [{ toggle: '회의', open: 'true', body: ['안건1'] }, '안건2!', '다른 글'], JSON.stringify(st));
    // 빈 토글 본문(빈 줄 하나)에 넣으면 빈 줄을 대신함
    const p2 = await openNote(browser,
      '<div class="toggle" data-open="true"><span class="toggle-arrow" contenteditable="false"></span><div class="toggle-title">빈 토글</div><div class="toggle-body"><div><br></div></div></div><div>넣을 줄</div>');
    await select(p2, '넣을 줄', 0);
    await p2.keyboard.press('Tab');
    assert.deepStrictEqual(await structure(p2), [{ toggle: '빈 토글', open: 'true', body: ['넣을 줄'] }]);
    // 위에 토글이 없으면 Tab 은 공백 4칸 (다른 버튼으로 포커스가 넘어가지 않음)
    await select(p2, '넣을 줄', 0);
    await p2.click('#editor');
    await p2.keyboard.press('Control+End');
    await p2.keyboard.press('Enter');
    await p2.keyboard.press('Shift+Tab'); // 토글 안 → 밖
    await p2.keyboard.press('Tab'); // 위가 토글 → 다시 안으로
    assert.strictEqual(await p2.evaluate(() => document.activeElement.id), 'editor');
    await p.close(); await p2.close();
  });

  await test('토글 제목 맨 앞 Backspace → 토글이 풀리고 안의 항목이 바깥으로 (맨 앞 토글 포함)', async () => {
    const p = await openNote(browser,
      '<div class="toggle" data-open="true"><span class="toggle-arrow" contenteditable="false"></span><div class="toggle-title"><b>회의</b></div><div class="toggle-body"><div>안건1</div><div>안건2</div></div></div><div>밖의 글</div>');
    await select(p, '회의', 0);
    await p.keyboard.press('Backspace');
    assert.deepStrictEqual(await structure(p), ['회의', '안건1', '안건2', '밖의 글']);
    assert.ok((await html(p)).startsWith('<div><b>회의</b></div>'), '제목 서식 유지: ' + await html(p));
    await p.keyboard.type('★'); // 캐럿은 풀린 제목 줄 맨 앞
    assert.deepStrictEqual((await structure(p))[0], '★회의');
    await p.close();
  });

  await test('예전 버전에서 깨진 채 저장된 토글은 열 때 자동 복구', async () => {
    const p = await openNote(browser,
      '<div class="toggle" data-open="true"><span class="toggle-arrow" contenteditable="false"></span>회의<div class="toggle-body"><div>안건1</div><div>안건2</div></div></div><div>밖의 글</div>');
    assert.deepStrictEqual(await structure(p), ['회의', '안건1', '안건2', '밖의 글']);
    // 정상 토글은 그대로
    const p2 = await openNote(browser,
      '<div class="toggle" data-open="false"><span class="toggle-arrow" contenteditable="false"></span><div class="toggle-title">정상</div><div class="toggle-body"><div>내용</div></div></div>');
    assert.deepStrictEqual(await structure(p2), [{ toggle: '정상', open: 'false', body: ['내용'] }]);
    await p.close(); await p2.close();
  });

  await test('붙여넣기: 굵게·색·여러 줄이 유지되고 줄 중간에 끼워짐', async () => {
    const p = await openNote(browser, '<div>앞뒤</div>');
    await select(p, '앞뒤', 1);
    await paste(p, {
      'text/html': '<meta charset="utf-8"><p style="font-size:30px;font-family:Arial;line-height:3">첫 <strong>굵게</strong> <span style="color:#ff0000">빨강</span></p><p><span style="background-color:yellow">노랑배경</span></p><p>셋째</p>',
      'text/plain': '첫 굵게 빨강\n노랑배경\n셋째',
    });
    assert.deepStrictEqual(await structure(p), ['앞첫 굵게 빨강', '노랑배경', '셋째뒤']);
    const h = await html(p);
    assert.match(h, /<b>굵게<\/b>/, h);
    assert.match(h, /color: rgb\(255, 0, 0\)/, h);
    assert.match(h, /background-color: rgb\(255, 255, 0\)/, h);
    assert.ok(!/font-size|font-family|line-height/.test(h), '글꼴·크기·줄간격은 버려야 함: ' + h);
    await p.close();
  });

  await test('붙여넣기: <details> 토글 (중첩 포함) 과 목록', async () => {
    const p = await openNote(browser, '<div><br></div>');
    await select(p, '', 0).catch(() => {});
    await p.click('#editor');
    await paste(p, {
      'text/html': '<details><summary>회의 <b>안건</b></summary><p>본문 1</p><details><summary>하위 토글</summary><p>깊은 내용</p></details></details>' +
        '<ul><li>사과</li><li>배<ul><li>작은 배</li></ul></li></ul><ol start="3"><li>셋</li><li>넷</li></ol>',
      'text/plain': '...',
    });
    const st = await structure(p);
    assert.deepStrictEqual(st.slice(0, 1), [{ toggle: '회의 안건', open: 'true', body: ['본문 1', { toggle: '하위 토글', open: 'true', body: ['깊은 내용'] }] }], JSON.stringify(st));
    const rest = st.slice(1).filter((x) => x !== '');
    assert.deepStrictEqual(rest, ['• 사과', '• 배', '    ◦ 작은 배', '3. 셋', '4. 넷'], JSON.stringify(rest));
    assert.ok((await html(p)).includes('<div class="toggle-title">회의 <b>안건</b></div>'), await html(p));
    // 붙여넣은 토글도 화살표로 접히고 Tab 등이 동작
    await p.click('#editor .toggle-arrow');
    assert.strictEqual(await p.getAttribute('#editor .toggle', 'data-open'), 'false');
    await p.close();
  });

  await test('붙여넣기: Google Docs 의 <b style="font-weight:normal"> 감싸기 / 검정 글자 / Notion 색 클래스', async () => {
    const p = await openNote(browser, '<div><br></div>');
    await p.click('#editor');
    await paste(p, {
      'text/html': '<b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="color:#000000;background-color:transparent;font-weight:400;">보통 글</span><span style="color:#000000;font-weight:700;">굵은 글</span></p></b>' +
        '<p><span class="highlight-red">노션빨강</span> <mark class="highlight-yellow_background">노션노랑배경</mark></p>',
      'text/plain': '보통 글굵은 글\n노션빨강 노션노랑배경',
    });
    const h = await html(p);
    assert.ok(!/<b>보통 글/.test(h), '"보통 글" 은 굵지 않아야 함: ' + h);
    assert.match(h, /<b>굵은 글<\/b>/, h);
    assert.ok(!/rgb\(0, 0, 0\)/.test(h), '검정 글자색은 버림: ' + h);
    assert.match(h, /color: rgb\(212, 76, 71\);">노션빨강/, h);
    assert.match(h, /background-color: rgb\(251, 243, 219\);">노션노랑배경/, h);
    await p.close();
  });

  await test('붙여넣기: Notion 형식 - <details color>, notion-toggle 마크업', async () => {
    const p = await openNote(browser, '<div><br></div>');
    await p.click('#editor');
    await paste(p, {
      'text/html': '<details color="red_background"><summary>빨간 배경 토글</summary><p>내용 <span color="blue">파랑</span></p></details>' +
        '<div class="notion-block notion-toggle notion-toggle-open"><button class="notion-toggle-button"><span class="notion-toggle-button-arrow">▶</span></button>' +
        '<span>웹 토글 <b>제목</b></span><div class="notion-toggle-content"><p>웹 내용 1</p><p>웹 내용 2</p></div></div>',
      'text/plain': '',
    });
    const st = await structure(p);
    assert.deepStrictEqual(st.filter((x) => x !== ''), [
      { toggle: '빨간 배경 토글', open: 'true', body: ['내용 파랑'] },
      { toggle: '웹 토글 제목', open: 'true', body: ['웹 내용 1', '웹 내용 2'] },
    ], JSON.stringify(st));
    const h = await html(p);
    assert.match(h, /background-color: rgb\(253, 235, 236\);">빨간 배경 토글/, h);
    assert.match(h, /color: rgb\(51, 126, 169\);[^"]*">파랑/, h);
    assert.ok(h.includes('<b>제목</b>'), h);
    await p.close();
  });

  await test('붙여넣기: Notion 마크다운 텍스트 (토글 제목 {toggle="true"}, <details>, 태그가 글자로 온 HTML)', async () => {
    const p = await openNote(browser, '<div><br></div>');
    await p.click('#editor');
    await paste(p, { 'text/plain': '## 회의 {toggle="true"}\n\t안건 **중요**\n\t- 항목\n\t\t- 하위 항목\n다음 줄' });
    let st = await structure(p);
    assert.deepStrictEqual(st, [{ toggle: '회의', open: 'true', body: ['안건 중요', '• 항목', '\u00a0\u00a0\u00a0\u00a0◦ 하위 항목'] }, '다음 줄'], JSON.stringify(st));
    assert.ok((await html(p)).includes('<b>중요</b>'));
    const p2 = await openNote(browser, '<div><br></div>');
    await p2.click('#editor');
    const md = '<details>\n<summary>토글 제목</summary>\n\t첫 줄\n\t<details>\n\t<summary>안쪽</summary>\n\t\t깊은 줄\n\t</details>\n</details>';
    // HTML 쪽에는 태그가 글자로 들어온 경우 (마크다운 → HTML 변환이 태그를 이스케이프한 경우)
    await paste(p2, { 'text/html': '<p>' + md.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '</p><p>') + '</p>', 'text/plain': md });
    st = await structure(p2);
    assert.deepStrictEqual(st, [{ toggle: '토글 제목', open: 'true', body: ['첫 줄', { toggle: '안쪽', open: 'true', body: ['깊은 줄'] }] }], JSON.stringify(st));
    await p.close(); await p2.close();
  });

  await test('붙여넣기: 토글 제목 안에 여러 줄 → 첫 줄은 제목, 나머지는 토글 안', async () => {
    const p = await openNote(browser,
      '<div class="toggle" data-open="true"><span class="toggle-arrow" contenteditable="false"></span><div class="toggle-title">제목:</div><div class="toggle-body"><div><br></div></div></div>');
    await select(p, '제목:', 3);
    await paste(p, { 'text/plain': ' 하나\n둘\n셋\n' });
    assert.deepStrictEqual(await structure(p), [{ toggle: '제목: 하나', open: 'true', body: ['둘', '셋'] }]);
    await p.close();
  });

  await test('붙여넣기: 텍스트만 있으면 줄과 들여쓰기 유지, Ctrl+Shift+V 는 서식 없이', async () => {
    const p = await openNote(browser, '<div><br></div>');
    await p.click('#editor');
    await paste(p, { 'text/plain': '첫 줄\n\t들여쓴 줄\n\n마지막' });
    assert.deepStrictEqual(await structure(p), ['첫 줄', '    들여쓴 줄', '', '마지막']);
    // 실제 앱과 같은 순서: Ctrl+Shift+V keydown → (Chromium 의) paste 이벤트
    await p.evaluate(() => document.getElementById('editor').dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyV', key: 'V', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })));
    await paste(p, { 'text/html': '<b>굵게</b>', 'text/plain': '굵게' });
    assert.ok(!(await html(p)).includes('<b>굵게</b>'), 'Ctrl+Shift+V 는 서식 없이: ' + await html(p));
    await p.close();
  });

  await test('제목줄 버튼이 최소 너비(260px)에서도 모두 보임', async () => {
    const p = await openNote(browser, '<div>x</div>');
    await p.setViewportSize({ width: 260, height: 300 });
    const r = await p.evaluate(() => {
      const bar = document.getElementById('titlebar');
      return { scroll: bar.scrollWidth, client: bar.clientWidth, closeRight: document.getElementById('btn-close').getBoundingClientRect().right };
    });
    assert.ok(r.scroll <= r.client && r.closeRight <= 260, JSON.stringify(r));
    await p.close();
  });

  await browser.close();
  console.log(results.join('\n'));
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
  console.log('editor tests: OK (' + results.length + ')');
})().catch((err) => { console.error(err); process.exit(1); });
