'use strict';
// 렌더러(에디터) 동작을 Chromium 에서 검증하는 테스트. 실행: npm test
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 380, height: 420 } });
  const saved = [];
  const titles = [];
  await page.exposeFunction('__recordSave', (html, title) => { saved.push(html); titles.push(title); });
  await page.addInitScript(() => {
    window.memo = {
      getState: async () => ({
        content: '<div>저장된 메모</div>',
        pinned: true,
        settings: { bgOpacity: 0.8, fontSize: 16, textColor: '#112233', paperColor: '#ffffff' },
        platform: 'test',
      }),
      saveContent: (html, title) => window.__recordSave(html, title),
      newNote: () => { window.__newNote = (window.__newNote || 0) + 1; },
      deleteNote: async () => { window.__deleteNote = (window.__deleteNote || 0) + 1; return false; },
      setSettings: (s) => { window.__settings = s; },
      setPinned: (f) => { window.__pinned = f; },
      setCollapsed: (f) => { window.__collapsed = f; },
      getBounds: async () => ({ x: 100, y: 100, width: 380, height: 420 }),
      setBounds: (b) => { window.__bounds = b; },
      showMoreMenu: (pos) => { window.__moreMenu = pos; },
      openOptions: (tab) => { window.__options = tab; },
      onQuickColors: () => {},
      onApplyQuickColor: () => {},
      minimize: () => {},
      close: () => {},
    };
  });
  await page.goto('file://' + path.resolve(__dirname, '../src/index.html'));
  await page.waitForFunction(() => document.querySelector('#editor').textContent.includes('저장된 메모'));

  // 1) 저장된 내용 / 표시 설정 복원 (CSS 변수까지)
  assert.strictEqual(await page.inputValue('#bg-opacity'), '80');
  assert.strictEqual(await page.textContent('#bg-opacity-value'), '80%');
  assert.strictEqual(await page.inputValue('#font-size'), '16');
  const css = await page.evaluate(() => {
    const st = getComputedStyle(document.documentElement);
    return {
      alpha: st.getPropertyValue('--paper-alpha').trim(),
      rgb: st.getPropertyValue('--paper-rgb').trim(),
      ink: st.getPropertyValue('--ink').trim(),
      font: getComputedStyle(document.getElementById('editor')).fontSize,
      paperBg: getComputedStyle(document.getElementById('paper')).backgroundColor,
    };
  });
  assert.deepStrictEqual(css, { alpha: '0.8', rgb: '255, 255, 255', ink: '#112233', font: '16px', paperBg: 'rgba(255, 255, 255, 0.8)' });

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

  // 7) 설정 패널: 배경 불투명도 0 까지 / 글자 크기 / 기본 색 / 초기화 / 단축키 / 고정 버튼
  assert.strictEqual(await page.isVisible('#settings'), false);
  await page.click('#btn-settings');
  assert.strictEqual(await page.isVisible('#settings'), true);
  await page.fill('#bg-opacity', '0');
  assert.strictEqual(await page.evaluate(() => window.__settings.bgOpacity), 0);
  assert.strictEqual(await page.$eval('#paper', (p) => getComputedStyle(p).backgroundColor), 'rgba(255, 255, 255, 0)', '배경 0% 는 완전 투명');
  const barAlpha = await page.$eval('#titlebar', (t) => getComputedStyle(t).backgroundImage + getComputedStyle(t).backgroundColor);
  assert.ok(barAlpha.includes('0.35'), '상단 바는 최소 불투명도를 유지해야 함: ' + barAlpha);
  await page.fill('#font-size', '24');
  assert.strictEqual(await page.$eval('#editor', (e) => getComputedStyle(e).fontSize), '24px');
  await page.$eval('#text-color', (i) => { i.value = '#ff0000'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.strictEqual(await page.$eval('#editor', (e) => getComputedStyle(e).color), 'rgb(255, 0, 0)');
  await page.$eval('#paper-color', (i) => { i.value = '#000000'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.fill('#bg-opacity', '100');
  assert.strictEqual(await page.$eval('#paper', (p) => getComputedStyle(p).backgroundColor), 'rgb(0, 0, 0)');
  await page.click('#editor');
  await page.keyboard.press('Control+Shift+ArrowDown');
  assert.strictEqual(await page.evaluate(() => window.__settings.bgOpacity), 0.95);
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  assert.strictEqual(await page.evaluate(() => window.__settings.fontSize), 26);
  await page.keyboard.press('Control+-');
  assert.strictEqual(await page.evaluate(() => window.__settings.fontSize), 25);
  await page.click('#btn-reset');
  assert.deepStrictEqual(await page.evaluate(() => window.__settings), { bgOpacity: 0.92, fontSize: 14, textColor: '#2b2b2b', paperColor: '#fff8c6' });
  await page.click('#btn-pin');
  assert.strictEqual(await page.evaluate(() => window.__pinned), false);

  // 7b) 색상 팔레트: 선택한 글자에 글자색 / 배경색, 같은 색을 다시 눌러도 적용
  await page.click('#editor');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('색칠');
  await page.keyboard.press('Shift+Home');
  await page.click('#btn-color');
  assert.strictEqual(await page.isVisible('#palette'), true, '팔레트가 열려야 함');
  await page.click('.pal-row[data-kind="text"] .swatch[title^="파랑"]');
  assert.strictEqual(await page.isVisible('#palette'), false, '색을 고르면 팔레트가 닫힘');
  assert.match(await page.innerHTML('#editor'), /<span style="color: rgb\(25, 113, 194\);">색칠<\/span>/, '글자색 적용: ' + await page.innerHTML('#editor'));
  await page.click('#btn-color');
  await page.click('.pal-row[data-kind="bg"] .swatch[title^="초록"]');
  assert.match(await page.innerHTML('#editor'), /background-color: rgb\(178, 242, 187\)/, '배경색 적용: ' + await page.innerHTML('#editor'));
  // '기본 글자색' 은 색 지정을 지움
  await page.click('#btn-color');
  await page.click('.pal-row[data-kind="text"] .swatch.none');
  assert.ok(!/color: rgb\(25, 113, 194\)/.test(await page.innerHTML('#editor')), '기본 글자색으로 되돌리기: ' + await page.innerHTML('#editor'));

  // 7c) 리사이즈 핸들 → setBounds 호출 (오른쪽 아래 모서리를 +40,+30 드래그)
  const se = await page.$('.rs-se');
  const box = await se.boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 25, box.y + 20);
  await page.mouse.move(box.x + 45, box.y + 35);
  await page.waitForTimeout(50);
  await page.mouse.up();
  const b = await page.evaluate(() => window.__bounds);
  assert.ok(b && b.width === 420 && b.height === 450 && b.x === 100 && b.y === 100, '리사이즈 결과: ' + JSON.stringify(b));

  // 7d) 내용 접기 버튼: 제목줄만 남기고 내용/설정 숨김, 다시 누르면 펼침
  assert.strictEqual(await page.isVisible('#editor'), true);
  await page.click('#btn-collapse');
  assert.strictEqual(await page.evaluate(() => window.__collapsed), true);
  assert.strictEqual(await page.isVisible('#editor'), false, '접으면 내용이 숨겨져야 함');
  assert.strictEqual(await page.isVisible('#settings'), false, '접으면 설정 패널도 숨겨져야 함');
  assert.strictEqual(await page.isVisible('#titlebar'), true, '제목줄은 남아야 함');
  assert.strictEqual(await page.isVisible('.rs-se'), false, '접힌 상태에서는 높이 조절 핸들 숨김');
  assert.strictEqual(await page.isVisible('.rs-e'), true, '접힌 상태에서도 너비 조절 가능');
  await page.click('#btn-collapse');
  assert.strictEqual(await page.evaluate(() => window.__collapsed), false);
  assert.strictEqual(await page.isVisible('#editor'), true);
  assert.strictEqual(await page.isVisible('#settings'), true, '설정 패널이 열려 있었다면 다시 보여야 함');

  // 7e) 여러 메모: + 버튼 / Ctrl+N 은 새 메모, 설정 패널의 삭제 버튼, 저장 시 첫 줄을 제목으로 전달
  await page.click('#btn-new');
  await page.click('#editor');
  await page.keyboard.press('Control+n');
  assert.strictEqual(await page.evaluate(() => window.__newNote), 2);
  await page.click('#btn-delete');
  assert.strictEqual(await page.evaluate(() => window.__deleteNote), 1);
  assert.strictEqual(titles[titles.length - 1], '저장된 메모', '첫 줄이 제목으로 저장되어야 함');

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
