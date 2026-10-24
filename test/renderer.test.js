'use strict';
// 렌더러(에디터) 동작을 Chromium 에서 검증하는 테스트. 실행: npm test
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 380, height: 420 } });
  const saved = [];
  await page.exposeFunction('__recordSave', (html) => saved.push(html));
  await page.addInitScript(() => {
    window.memo = {
      getState: async () => ({ content: '<div>저장된 메모</div>', opacity: 0.8, pinned: true, platform: 'test' }),
      saveContent: (html) => window.__recordSave(html),
      setOpacity: (v) => { window.__opacity = v; },
      setPinned: (f) => { window.__pinned = f; },
      minimize: () => {},
      close: () => {},
    };
  });
  await page.goto('file://' + path.resolve(__dirname, '../src/index.html'));
  await page.waitForFunction(() => document.querySelector('#editor').textContent.includes('저장된 메모'));

  // 1) 저장된 내용 / 투명도 복원
  assert.strictEqual(await page.inputValue('#opacity'), '80');
  assert.strictEqual(await page.textContent('#opacity-value'), '80%');

  // 2) 굵게
  await page.click('#editor');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('굵은 글씨');
  await page.keyboard.press('Control+b');
  await page.keyboard.type(' 보통');
  const html1 = await page.innerHTML('#editor');
  assert.match(html1, /<b>굵은 글씨<\/b>/, '굵게가 적용되어야 함: ' + html1);
  assert.ok(await page.$eval('#btn-bold', (b) => !b.classList.contains('active')), '보통 글씨 위치에서 B 버튼 비활성');

  // 3) "> " 입력으로 토글 블록 생성 → 제목 입력 → Enter 로 본문 → 본문 입력
  await page.keyboard.press('Enter');
  await page.keyboard.type('> ');
  assert.strictEqual(await page.$$eval('#editor .toggle', (t) => t.length), 1, "'> ' 로 토글이 생성되어야 함");
  await page.keyboard.type('회의 메모');
  await page.keyboard.press('Enter');
  await page.keyboard.type('첫 번째 항목');
  await page.keyboard.press('Enter');
  await page.keyboard.type('두 번째 항목');
  assert.strictEqual(await page.textContent('#editor .toggle-title'), '회의 메모');
  assert.deepStrictEqual(
    await page.$$eval('#editor .toggle-body > div', (ds) => ds.map((d) => d.textContent)),
    ['첫 번째 항목', '두 번째 항목'],
  );

  // 4) 본문 빈 줄에서 Enter 두 번 → 토글 밖으로 탈출
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('토글 밖 문장');
  const outside = await page.$eval('#editor', (ed) => {
    const last = ed.lastElementChild;
    return { text: last.textContent, inToggle: !!last.closest('.toggle') };
  });
  assert.deepStrictEqual(outside, { text: '토글 밖 문장', inToggle: false });
  assert.strictEqual(await page.$$eval('#editor .toggle-body > div', (ds) => ds.length), 2, '빈 꼬리 줄은 제거되어야 함');

  // 5) 화살표 클릭으로 접기/펼치기, 접힌 상태 저장
  await page.click('#editor .toggle-arrow');
  assert.strictEqual(await page.getAttribute('#editor .toggle', 'data-open'), 'false');
  assert.strictEqual(await page.isVisible('#editor .toggle-body'), false, '접힌 본문은 숨겨져야 함');
  await page.waitForTimeout(400);
  assert.match(saved[saved.length - 1], /data-open="false"/, '접힌 상태가 저장되어야 함');
  await page.click('#editor .toggle-arrow');
  assert.strictEqual(await page.isVisible('#editor .toggle-body'), true);

  // 6) 툴바 버튼으로 토글 생성 + 빈 토글에서 Backspace 로 해제
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.click('#btn-toggle');
  assert.strictEqual(await page.$$eval('#editor .toggle', (t) => t.length), 2);
  await page.keyboard.press('Backspace');
  assert.strictEqual(await page.$$eval('#editor .toggle', (t) => t.length), 1, '빈 토글은 Backspace 로 해제');

  // 7) 투명도 슬라이더 / 단축키 / 고정 버튼
  await page.fill('#opacity', '50');
  assert.strictEqual(await page.evaluate(() => window.__opacity), 0.5);
  await page.click('#editor');
  await page.keyboard.press('Control+Shift+ArrowDown');
  assert.strictEqual(await page.evaluate(() => window.__opacity), 0.45);
  await page.click('#btn-pin');
  assert.strictEqual(await page.evaluate(() => window.__pinned), false);

  // 8) 붙여넣기는 서식 제거
  await page.click('#editor');
  await page.keyboard.press('Control+End');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/html', '<h1 style="color:red">큰 제목</h1>');
    dt.setData('text/plain', '큰 제목');
    document.getElementById('editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  assert.ok(!(await page.innerHTML('#editor')).includes('<h1'), '붙여넣기 HTML 서식은 제거되어야 함');

  await page.screenshot({ path: path.join(__dirname, 'output', 'editor.png') }).catch(() => {});
  await browser.close();
  console.log('renderer tests: OK (' + saved.length + ' saves recorded)');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
