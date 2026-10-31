'use strict';

(function () {
  const editor = document.getElementById('editor');
  const btnBold = document.getElementById('btn-bold');
  const btnToggle = document.getElementById('btn-toggle');
  const btnPin = document.getElementById('btn-pin');
  const btnCollapse = document.getElementById('btn-collapse');
  const btnMin = document.getElementById('btn-min');
  const btnClose = document.getElementById('btn-close');
  const btnSettings = document.getElementById('btn-settings');
  const settingsPanel = document.getElementById('settings');
  const bgOpacityInput = document.getElementById('bg-opacity');
  const bgOpacityValue = document.getElementById('bg-opacity-value');
  const fontSizeInput = document.getElementById('font-size');
  const fontSizeValue = document.getElementById('font-size-value');
  const textColorInput = document.getElementById('text-color');
  const paperColorInput = document.getElementById('paper-color');
  const btnReset = document.getElementById('btn-reset');
  const btnNew = document.getElementById('btn-new');
  const btnDelete = document.getElementById('btn-delete');
  const btnColor = document.getElementById('btn-color');
  const btnMore = document.getElementById('btn-more');
  const palette = document.getElementById('palette');
  const palPicker = document.getElementById('pal-picker');
  const palClear = document.getElementById('pal-clear');
  const palQuick = document.getElementById('pal-quick');

  // Electron 밖(브라우저 테스트)에서도 동작하도록 안전한 대체 API
  const api = window.memo || {
    getState: async () => ({ content: '', pinned: true, settings: {}, defaults: {}, platform: 'web' }),
    saveContent: () => {},
    newNote: () => {},
    deleteNote: async () => false,
    setSettings: () => {},
    setPinned: () => {},
    setCollapsed: () => {},
    getBounds: async () => null,
    setBounds: () => {},
    minimize: () => {},
    close: () => {},
    showMoreMenu: () => {},
    openOptions: () => {},
    onQuickColors: () => {},
    onApplyQuickColor: () => {},
  };

  const DEFAULTS = { bgOpacity: 0.92, fontSize: 14, textColor: '#2b2b2b', paperColor: '#fff8c6' };
  let settings = { ...DEFAULTS };

  document.execCommand('defaultParagraphSeparator', false, 'div');

  // -------------------------------------------------------------------------
  // 유틸: 선택 영역 / 블록 탐색
  // -------------------------------------------------------------------------
  function getRange() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0);
    return editor.contains(r.startContainer) ? r : null;
  }

  function setCaret(node, offset) {
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function caretToStart(el) {
    const first = firstTextNode(el);
    if (first) setCaret(first, 0);
    else setCaret(el, 0);
  }

  function firstTextNode(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    return walker.nextNode();
  }

  function makeLine(text) {
    const d = document.createElement('div');
    if (text) d.textContent = text;
    else d.appendChild(document.createElement('br'));
    return d;
  }

  // 캐럿이 속한 "줄 블록": editor 직속 자식, 또는 .toggle-body 직속 자식, 또는 .toggle-title
  function getLineBlock(node) {
    let n = node;
    while (n && n !== editor) {
      const p = n.parentNode;
      if (!p) return null;
      if (n.nodeType === 1 && n.classList.contains('toggle-title')) return n;
      if (p === editor || (p.nodeType === 1 && p.classList.contains('toggle-body'))) {
        return n.nodeType === 1 ? n : wrapLooseNode(n);
      }
      n = p;
    }
    return null;
  }

  // 블록 없이 editor 바로 아래 놓인 텍스트 노드를 div 로 감싼다
  function wrapLooseNode(textNode) {
    const d = document.createElement('div');
    textNode.parentNode.insertBefore(d, textNode);
    d.appendChild(textNode);
    return d;
  }

  function isEmptyBlock(el) {
    return !el || el.textContent.trim() === '' && !el.querySelector('.toggle');
  }

  function ensureNotEmpty() {
    if (editor.childNodes.length === 0 || (editor.childNodes.length === 1 && editor.firstChild.nodeName === 'BR')) {
      editor.innerHTML = '';
      editor.appendChild(makeLine(''));
    }
    editor.classList.toggle('is-empty', editor.textContent.trim() === '' && !editor.querySelector('.toggle'));
  }

  // -------------------------------------------------------------------------
  // 토글 블록
  // -------------------------------------------------------------------------
  function createToggle(titleText, open = true) {
    const t = document.createElement('div');
    t.className = 'toggle';
    t.dataset.open = open ? 'true' : 'false';

    const arrow = document.createElement('span');
    arrow.className = 'toggle-arrow';
    arrow.setAttribute('contenteditable', 'false');
    arrow.setAttribute('title', '펼치기/접기');

    const title = document.createElement('div');
    title.className = 'toggle-title';
    if (titleText) title.textContent = titleText;

    const body = document.createElement('div');
    body.className = 'toggle-body';
    body.appendChild(makeLine(''));

    t.append(arrow, title, body);
    return t;
  }

  function setToggleOpen(toggle, open) {
    toggle.dataset.open = open ? 'true' : 'false';
    scheduleSave();
  }

  // 현재 줄을 토글 블록으로 변환 (줄 내용과 서식 → 토글 제목). caretAt: 'start' | 'end'
  function convertLineToToggle(line, caretAt = 'end') {
    const toggle = createToggle('');
    const titleEl = toggle.querySelector('.toggle-title');
    while (line.firstChild) titleEl.appendChild(line.firstChild);
    if (titleEl.textContent === '') titleEl.innerHTML = '';
    line.replaceWith(toggle);
    if (caretAt === 'start' || !titleEl.textContent) {
      caretToStart(titleEl);
    } else {
      const tn = lastTextNode(titleEl);
      setCaret(tn, tn.length);
    }
    scheduleSave();
    return toggle;
  }

  // 줄 맨 앞부터 캐럿까지의 글자
  function textBeforeCaret(line, r) {
    const pre = r.cloneRange();
    pre.setStart(line, 0);
    return pre.toString();
  }

  // "> " 또는 ">" + Tab 으로 토글 만들기: 앞의 '>' (와 공백) 을 지우고 나머지 글을 토글 제목으로
  function tryAutoToggle(line, r, typedSpace) {
    if (!line || line.classList.contains('toggle-title') || line.classList.contains('toggle')) return false;
    const before = textBeforeCaret(line, r);
    const ok = typedSpace ? /^>[ \u00a0]$/.test(before) : before === '>';
    if (!ok) return false;
    const del = r.cloneRange();
    del.setStart(line, 0);
    del.deleteContents();
    convertLineToToggle(line, 'start');
    return true;
  }

  // 선택/캐럿 위치를 기억했다가 블록을 옮긴 뒤 되돌린다 (노드를 옮기면 선택이 풀리므로)
  function withSelectionKept(fn) {
    const sel = window.getSelection();
    const r = sel.rangeCount ? sel.getRangeAt(0) : null;
    const saved = r && { sc: r.startContainer, so: r.startOffset, ec: r.endContainer, eo: r.endOffset };
    fn();
    if (saved && editor.contains(saved.sc) && editor.contains(saved.ec)) {
      try { sel.setBaseAndExtent(saved.sc, saved.so, saved.ec, saved.eo); } catch { /* ignore */ }
    }
  }

  // Tab: 바로 위가 토글이면 이 줄(또는 토글)을 그 토글 안 맨 끝으로 넣는다
  function indentBlock(block) {
    const prev = block.previousElementSibling;
    if (!prev || !prev.classList.contains('toggle')) return false;
    const body = prev.querySelector(':scope > .toggle-body');
    withSelectionKept(() => {
      if (body.children.length === 1 && isEmptyBlock(body.firstElementChild) && body.firstElementChild !== block) {
        body.firstElementChild.remove();
      }
      body.appendChild(block);
      prev.dataset.open = 'true';
    });
    scheduleSave();
    return true;
  }

  // 토글 풀기: 제목(과 토글 안에 흩어진 글자)은 일반 줄로, 안의 항목은 모두 바깥으로 꺼낸다
  function unwrapToggle(toggle) {
    const title = toggle.querySelector(':scope > .toggle-title');
    const body = toggle.querySelector(':scope > .toggle-body');
    const line = document.createElement('div');
    Array.from(toggle.childNodes).forEach((n) => {
      if (n === body) return;
      if (n.nodeType === 1 && n.classList.contains('toggle-arrow')) return;
      if (n === title) { while (title.firstChild) line.appendChild(title.firstChild); return; }
      line.appendChild(n);
    });
    if (line.textContent === '' && !line.querySelector('br')) line.innerHTML = '<br>';
    let lifted = body ? Array.from(body.childNodes) : [];
    if (lifted.length === 1 && lifted[0].nodeType === 1 && isEmptyBlock(lifted[0])) lifted = []; // 빈 본문은 버림
    lifted = lifted.map((n) => (n.nodeType === 1 ? n : (() => { const d = document.createElement('div'); d.appendChild(n); return d; })()));
    toggle.replaceWith(line, ...lifted);
    return line;
  }

  // 구조가 깨진 토글(제목 칸이나 화살표가 지워졌거나, 토글 안에 글자가 흩어진 경우)을 찾아 풀어 준다
  function repairToggles() {
    let changed = false;
    editor.querySelectorAll('.toggle').forEach((t) => {
      if (!t.isConnected) return;
      const title = t.querySelector(':scope > .toggle-title');
      const arrow = t.querySelector(':scope > .toggle-arrow');
      const loose = Array.from(t.childNodes).some((n) => n !== title && n !== arrow &&
        !(n.nodeType === 1 && n.classList.contains('toggle-body')) &&
        !(n.nodeType === 3 && !n.nodeValue.trim()));
      if (!title || !arrow || loose) {
        withSelectionKept(() => unwrapToggle(t));
        changed = true;
      } else if (!t.querySelector(':scope > .toggle-body')) {
        const body = document.createElement('div');
        body.className = 'toggle-body';
        body.appendChild(makeLine(''));
        title.after(body);
        changed = true;
      }
    });
    return changed;
  }

  // Shift+Tab: 토글 안의 줄(또는 토글)을 그 토글 바로 아래로 꺼낸다
  function outdentBlock(block) {
    const body = block.parentElement;
    if (!body || !body.classList.contains('toggle-body')) return false;
    const toggle = body.closest('.toggle');
    withSelectionKept(() => {
      toggle.after(block);
      if (body.children.length === 0) body.appendChild(makeLine(''));
    });
    scheduleSave();
    return true;
  }

  function insertToggleAtCaret() {
    editor.focus();
    const r = getRange();
    if (!r) {
      const toggle = createToggle('');
      editor.appendChild(toggle);
      caretToStart(toggle.querySelector('.toggle-title'));
      scheduleSave();
      return;
    }
    const line = getLineBlock(r.startContainer);
    if (!line) return;

    if (line.classList.contains('toggle-title') || line.closest('.toggle-body') && isEmptyBlock(line) === false) {
      // 이미 토글 안에 있으면 바로 뒤에 새 토글을 추가
      const host = line.classList.contains('toggle-title') ? line.closest('.toggle') : line;
      const toggle = createToggle('');
      host.after(toggle);
      caretToStart(toggle.querySelector('.toggle-title'));
      scheduleSave();
      return;
    }
    if (line.classList.contains('toggle')) {
      const toggle = createToggle('');
      line.after(toggle);
      caretToStart(toggle.querySelector('.toggle-title'));
      scheduleSave();
      return;
    }
    convertLineToToggle(line);
  }

  // -------------------------------------------------------------------------
  // 굵게
  // -------------------------------------------------------------------------
  function toggleBold() {
    editor.focus();
    document.execCommand('bold');
    updateBoldState();
    scheduleSave();
  }

  function updateBoldState() {
    let on = false;
    try { on = document.queryCommandState('bold'); } catch { /* ignore */ }
    btnBold.classList.toggle('active', on);
  }

  // -------------------------------------------------------------------------
  // 키 입력 처리
  // -------------------------------------------------------------------------
  editor.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const code = e.code;

    if (e.key === 'Escape' && !palette.hidden) {
      closePalette();
      return;
    }
    if (mod && !e.shiftKey && !e.altKey) {
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(code);
      if (digit) {
        e.preventDefault();
        applyQuickColor(Number(digit[1]) - 1);
        return;
      }
      if (code === 'KeyB') { e.preventDefault(); toggleBold(); return; }
      if (code === 'KeyN') { e.preventDefault(); flushSave(); api.newNote(); return; }
      if (code === 'Backslash') { e.preventDefault(); clearFormatting(); return; }
      if (code === 'Equal' || code === 'NumpadAdd') { e.preventDefault(); updateSettings({ fontSize: settings.fontSize + 1 }); return; }
      if (code === 'Minus' || code === 'NumpadSubtract') { e.preventDefault(); updateSettings({ fontSize: settings.fontSize - 1 }); return; }
      if (code === 'Digit0' || code === 'Numpad0') { e.preventDefault(); updateSettings({ fontSize: DEFAULTS.fontSize }); return; }
    }
    if (mod && e.shiftKey && code === 'KeyV') {
      plainPasteNext = true; // 서식 없이 붙여넣기 (Chromium 은 같은 paste 이벤트를 보내므로 표시만 해 둠)
      setTimeout(() => { plainPasteNext = false; }, 500);
      return;
    }
    if (mod && e.shiftKey && code === 'KeyT') {
      e.preventDefault();
      insertToggleAtCaret();
      return;
    }
    if (mod && e.shiftKey && (code === 'ArrowUp' || code === 'ArrowDown')) {
      e.preventDefault();
      updateSettings({ bgOpacity: settings.bgOpacity + (code === 'ArrowUp' ? 0.05 : -0.05) });
      return;
    }

    const r = getRange();
    if (!r) return;
    const line = getLineBlock(r.startContainer);
    if (!line) return;

    // Tab: '>' 뒤면 토글 만들기, 바로 위가 토글이면 그 안으로 넣기 / Shift+Tab: 토글 밖으로 꺼내기
    if (code === 'Tab' && !mod && !e.altKey) {
      e.preventDefault(); // 포커스가 다른 버튼으로 넘어가지 않도록
      if (e.isComposing) return;
      if (!e.shiftKey && r.collapsed && tryAutoToggle(line, r, false)) return;
      const block = line.classList.contains('toggle-title') ? line.closest('.toggle') : line;
      if (e.shiftKey) outdentBlock(block);
      else if (!indentBlock(block)) document.execCommand('insertText', false, '\u00a0\u00a0\u00a0\u00a0');
      return;
    }

    // 토글 제목에서 Enter → 본문 첫 줄로 이동 (접혀 있으면 펼침)
    if (e.key === 'Enter' && !e.shiftKey && line.classList.contains('toggle-title')) {
      e.preventDefault();
      const toggle = line.closest('.toggle');
      setToggleOpen(toggle, true);
      const body = toggle.querySelector('.toggle-body');
      let first = body.firstElementChild;
      if (!first || !isEmptyBlock(first)) {
        first = makeLine('');
        body.insertBefore(first, body.firstChild);
      }
      setCaret(first, 0);
      scheduleSave();
      return;
    }

    // 토글 본문의 빈 마지막 줄에서 Enter → 토글 밖으로 나가기
    if (e.key === 'Enter' && !e.shiftKey && line.parentNode.classList.contains('toggle-body')) {
      const body = line.parentNode;
      if (isEmptyBlock(line) && line === body.lastElementChild && body.children.length > 1) {
        e.preventDefault();
        const toggle = body.closest('.toggle');
        line.remove();
        const out = makeLine('');
        toggle.after(out);
        setCaret(out, 0);
        scheduleSave();
        return;
      }
    }

    // 토글 제목 맨 앞에서 Backspace → 토글 풀기 (제목은 일반 줄, 안의 항목은 바깥으로)
    if (e.key === 'Backspace' && line.classList.contains('toggle-title') && r.collapsed && textBeforeCaret(line, r) === '') {
      e.preventDefault();
      const plain = unwrapToggle(line.closest('.toggle'));
      caretToStart(plain);
      ensureNotEmpty();
      scheduleSave();
      return;
    }

    // 토글 본문 첫 줄 맨 앞에서 Backspace → 제목 끝으로 이동 (줄 삭제는 비어 있을 때만)
    if (e.key === 'Backspace' && r.collapsed && line.parentNode.classList.contains('toggle-body')) {
      const body = line.parentNode;
      const pre = r.cloneRange();
      pre.setStart(line, 0);
      if (pre.toString() === '' && line === body.firstElementChild) {
        e.preventDefault();
        const title = body.closest('.toggle').querySelector('.toggle-title');
        if (isEmptyBlock(line) && body.children.length > 1) line.remove();
        const tn = lastTextNode(title);
        if (tn) setCaret(tn, tn.length); else setCaret(title, title.childNodes.length);
        scheduleSave();
      }
    }
  });

  function lastTextNode(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let last = null;
    let n;
    while ((n = walker.nextNode())) last = n;
    return last;
  }

  // 화살표 클릭 → 펼치기/접기
  editor.addEventListener('mousedown', (e) => {
    const arrow = e.target.closest('.toggle-arrow');
    if (!arrow) return;
    e.preventDefault();
    const toggle = arrow.closest('.toggle');
    setToggleOpen(toggle, toggle.dataset.open === 'false');
  });

  // -------------------------------------------------------------------------
  // 붙여넣기: 다른 곳의 서식(굵게·색·줄바꿈·목록·토글)을 메모 형식으로 정리해서 유지
  // -------------------------------------------------------------------------
  let plainPasteNext = false;
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const cd = e.clipboardData || window.clipboardData;
    const plainOnly = plainPasteNext;
    const html = plainOnly ? '' : cd.getData('text/html');
    plainPasteNext = false;
    const text = cd.getData('text/plain');
    const blocks = plainOnly ? window.MemoPaste.fromText(text) : window.MemoPaste.fromClipboard(html, text);
    if (!blocks.length) return;
    insertBlocks(blocks);
  });

  function insertBlocks(blocks) {
    const r = getRange();
    const line = r && getLineBlock(r.startContainer);
    const single = blocks.length === 1 && blocks[0].type === 'line';

    if (single) {
      if (blocks[0].html) document.execCommand('insertHTML', false, blocks[0].html);
    } else if (line && line.classList.contains('toggle-title')) {
      // 토글 제목 안: 첫 줄만 제목에, 나머지는 토글 본문 맨 앞에
      let rest = blocks;
      if (blocks[0].type === 'line') {
        if (blocks[0].html) document.execCommand('insertHTML', false, blocks[0].html);
        rest = blocks.slice(1);
      }
      const toggle = line.closest('.toggle');
      const body = toggle.querySelector(':scope > .toggle-body');
      const tmp = document.createElement('div');
      tmp.innerHTML = window.MemoPaste.renderBlocks(rest);
      if (body.children.length === 1 && isEmptyBlock(body.firstElementChild)) body.firstElementChild.remove();
      body.prepend(...tmp.childNodes);
      toggle.dataset.open = 'true';
    } else {
      document.execCommand('insertHTML', false, window.MemoPaste.renderBlocks(blocks));
    }
    normalizeEditor();
    ensureNotEmpty();
    scheduleSave();
  }

  // 붙여넣기 뒤 구조 정리: 줄 안에 줄이 끼거나 토글 부품이 빠진 경우를 바로잡고, 불필요한 스타일 제거
  const KEEP_STYLES = ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration-line'];
  function normalizeEditor() {
    repairToggles();
    editor.querySelectorAll('.toggle').forEach((t) => {
      t.querySelector(':scope > .toggle-arrow').setAttribute('contenteditable', 'false');
      const body = t.querySelector(':scope > .toggle-body');
      if (!body.firstChild) body.appendChild(makeLine(''));
      if (!t.dataset.open) t.dataset.open = 'true';
    });
    flattenLines(editor);
    editor.querySelectorAll('.toggle-body').forEach(flattenLines);
    editor.querySelectorAll('[style]').forEach((el) => {
      if (el.classList.contains('toggle') || el === editor) return;
      const keep = KEEP_STYLES.map((prop) => [prop, el.style.getPropertyValue(prop)]).filter(([, v]) => v);
      el.removeAttribute('style');
      keep.forEach(([prop, v]) => el.style.setProperty(prop, v));
      if (!el.getAttribute('style')) el.removeAttribute('style');
    });
  }

  // 컨테이너(편집 영역/토글 본문)의 직속 줄 안에 또 다른 줄(div)이 들어가 있으면 펼쳐서 형제 줄로 만든다
  function flattenLines(container) {
    Array.from(container.children).forEach((line) => {
      if (line.tagName !== 'DIV' || line.classList.contains('toggle')) return;
      if (!Array.from(line.children).some((c) => c.tagName === 'DIV')) return;
      const out = [];
      let current = null;
      Array.from(line.childNodes).forEach((n) => {
        if (n.nodeType === 1 && n.tagName === 'DIV') {
          current = null;
          out.push(n);
        } else {
          if (!current) { current = document.createElement('div'); out.push(current); }
          current.appendChild(n);
        }
      });
      const kept = out.filter((d) => d.classList.contains('toggle') || d.textContent !== '' || d.querySelector('br'));
      if (kept.length) line.replaceWith(...kept);
    });
  }

  editor.addEventListener('input', (e) => {
    // "> " 를 치면 토글로 (한글 입력기에서도 동작하도록 keydown 대신 입력 결과로 판단)
    if (e.inputType === 'insertText' && e.data === ' ' && !e.isComposing) {
      const r = getRange();
      if (r && r.collapsed) tryAutoToggle(getLineBlock(r.startContainer), r, true);
    }
    repairToggles();
    ensureNotEmpty();
    scheduleSave();
  });
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === editor) updateBoldState();
  });

  // -------------------------------------------------------------------------
  // 저장
  // -------------------------------------------------------------------------
  // 트레이 메뉴에 보일 제목: 첫 번째로 글자가 있는 줄 (토글이면 토글 제목)
  function noteTitle() {
    for (const el of editor.children) {
      const src = el.classList && el.classList.contains('toggle') ? el.querySelector('.toggle-title') : el;
      const text = (src ? src.textContent : '').replace(/\s+/g, ' ').trim();
      if (text) return text.slice(0, 60);
    }
    return '';
  }

  let saveTimer = null;
  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    api.saveContent(editor.innerHTML, noteTitle());
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 300);
  }
  // 창이 포커스를 잃거나 닫힐 때 (트레이에서 종료 등) 마지막 입력을 바로 저장
  window.addEventListener('blur', () => { if (saveTimer) flushSave(); });
  window.addEventListener('beforeunload', () => { if (saveTimer) flushSave(); });

  // -------------------------------------------------------------------------
  // 툴바: 굵게 / 토글 / 선택 글자색 / 형광펜
  // -------------------------------------------------------------------------
  btnBold.addEventListener('mousedown', (e) => e.preventDefault()); // 포커스 유지
  btnBold.addEventListener('click', toggleBold);
  btnToggle.addEventListener('mousedown', (e) => e.preventDefault());
  btnToggle.addEventListener('click', insertToggleAtCaret);
  btnMin.addEventListener('click', () => api.minimize());
  btnClose.addEventListener('click', () => {
    flushSave();
    api.close();
  });
  btnNew.addEventListener('click', () => {
    flushSave();
    api.newNote();
  });
  btnDelete.addEventListener('click', () => {
    flushSave();
    api.deleteNote();
  });

  // -------------------------------------------------------------------------
  // 글자색 / 배경색
  //   팔레트의 색을 누를 때마다 바로 적용 (같은 색을 다시 골라도 적용됨)
  //   색 선택 창이나 메뉴를 여는 동안 편집 영역의 선택이 풀리므로, 직전 선택을 기억했다가 복원
  // -------------------------------------------------------------------------
  let savedRange = null;
  function rememberSelection() {
    const r = getRange();
    if (r) savedRange = r.cloneRange();
  }
  // 편집 영역에 지금 선택이 있으면 그것을 쓰고, 포커스가 빠져 있을 때만 기억해 둔 선택으로 되돌린다
  function restoreSelection() {
    if (document.activeElement === editor && getRange()) return;
    editor.focus();
    if (!savedRange || !editor.contains(savedRange.startContainer)) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === editor) rememberSelection();
  });

  const MARKER = { text: '#010203', bg: '#010204' }; // '기본/없음' 을 고를 때 잠시 칠했다가 지우는 표식 색
  const MARKER_RGB = { text: 'rgb(1, 2, 3)', bg: 'rgb(1, 2, 4)' };

  function applyColor(kind, color) {
    restoreSelection();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(kind === 'text' ? 'foreColor' : 'hiliteColor', false, color || MARKER[kind]);
    if (!color) {
      const prop = kind === 'text' ? 'color' : 'background-color';
      editor.querySelectorAll('[style]').forEach((el) => {
        if (el.style.getPropertyValue(prop) === MARKER_RGB[kind]) {
          el.style.removeProperty(prop);
          if (!el.getAttribute('style')) el.removeAttribute('style');
        }
      });
    } else {
      btnColor.style.setProperty(kind === 'text' ? '--swatch' : '--swatch-bg', color);
    }
    rememberSelection();
    scheduleSave();
  }

  function clearFormatting() {
    restoreSelection();
    document.execCommand('removeFormat');
    applyColor('bg', null); // removeFormat 이 남기는 배경색까지 정리
    updateBoldState();
    scheduleSave();
  }

  // 빠른 색상 (Ctrl+1~9): 목록과 색은 ⋯ → 빠른 색상 편집에서 바꿀 수 있음
  let quickColors = [];
  function applyQuickColor(index) {
    const q = quickColors[index];
    if (!q) return;
    applyColor(q.type === 'bg' ? 'bg' : 'text', q.color);
  }

  const PALETTE = {
    text: ['#e03131', '#f08c00', '#e8a400', '#2f9e44', '#1971c2', '#7048e8', '#c2255c', '#868e96'],
    bg: ['#ffc9c9', '#ffd8a8', '#ffec99', '#b2f2bb', '#a5d8ff', '#d0bfff', '#fcc2d7', '#dee2e6'],
  };
  const COLOR_NAMES = {
    '#e03131': '빨강', '#f08c00': '주황', '#e8a400': '노랑', '#2f9e44': '초록', '#1971c2': '파랑',
    '#7048e8': '보라', '#c2255c': '분홍', '#868e96': '회색', '#ffc9c9': '빨강', '#ffd8a8': '주황',
    '#ffec99': '노랑', '#b2f2bb': '초록', '#a5d8ff': '파랑', '#d0bfff': '보라', '#fcc2d7': '분홍',
    '#dee2e6': '회색',
  };
  const RECENT_KEY = (kind) => 'floatmemo.recentColor.' + kind;
  function loadRecent(kind) {
    try { const v = localStorage.getItem(RECENT_KEY(kind)); return isHex(v || '') ? v : null; } catch { return null; }
  }
  function saveRecent(kind, v) {
    try { localStorage.setItem(RECENT_KEY(kind), v); } catch { /* 저장 실패는 무시 */ }
  }

  function swatchButton(kind, color, extraClass, title, label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (extraClass ? ' ' + extraClass : '');
    b.title = title;
    if (label) b.textContent = label;
    if (color) {
      if (kind === 'text') { b.style.color = color; b.textContent = label || 'A'; }
      else b.style.background = color;
    }
    b.addEventListener('mousedown', (e) => e.preventDefault()); // 편집 영역의 선택 유지
    return b;
  }

  function renderPalette() {
    palette.querySelectorAll('.pal-row').forEach((row) => {
      const kind = row.dataset.kind;
      row.innerHTML = '';
      const none = swatchButton(kind, null, 'none', kind === 'text' ? '기본 글자색' : '배경색 없음');
      none.addEventListener('click', () => { closePalette(); applyColor(kind, null); });
      row.appendChild(none);
      PALETTE[kind].forEach((c) => {
        const b = swatchButton(kind, c, '', (COLOR_NAMES[c] || c) + (kind === 'text' ? ' 글자' : ' 배경'));
        b.addEventListener('click', () => { closePalette(); applyColor(kind, c); });
        row.appendChild(b);
      });
      const recent = loadRecent(kind);
      if (recent && !PALETTE[kind].includes(recent)) {
        const b = swatchButton(kind, recent, 'recent', '최근에 직접 고른 색 ' + recent);
        b.addEventListener('click', () => { closePalette(); applyColor(kind, recent); });
        row.appendChild(b);
      }
      const custom = swatchButton(kind, null, 'custom', '직접 고르기…', '+');
      custom.addEventListener('click', () => openPicker(kind));
      row.appendChild(custom);
    });
  }

  // 직접 고르기: 매번 확실히 '변경' 이 일어나도록 고르기 전 값을 표식 색으로 맞춰 둔다
  function openPicker(kind) {
    rememberSelection();
    palPicker.dataset.kind = kind;
    palPicker.value = '#000001';
    palPicker.click();
  }
  palPicker.addEventListener('change', () => {
    const kind = palPicker.dataset.kind || 'text';
    const v = palPicker.value;
    if (!isHex(v) || v === '#000001') return;
    saveRecent(kind, v);
    renderPalette();
    closePalette();
    applyColor(kind, v);
  });

  function openPalette() {
    rememberSelection();
    renderPalette();
    const left = Math.max(6, Math.min(btnColor.offsetLeft - 4, document.body.clientWidth - 248));
    palette.style.left = left + 'px';
    palette.hidden = false;
    btnColor.classList.add('active');
  }
  function closePalette() {
    palette.hidden = true;
    btnColor.classList.remove('active');
  }
  btnColor.addEventListener('mousedown', (e) => e.preventDefault());
  btnColor.addEventListener('click', () => (palette.hidden ? openPalette() : closePalette()));
  document.addEventListener('mousedown', (e) => {
    if (!palette.hidden && !palette.contains(e.target) && !btnColor.contains(e.target)) closePalette();
  });
  palClear.addEventListener('mousedown', (e) => e.preventDefault());
  palClear.addEventListener('click', () => { closePalette(); clearFormatting(); });
  palQuick.addEventListener('mousedown', (e) => e.preventDefault());
  palQuick.addEventListener('click', () => { closePalette(); api.openOptions('colors'); });

  // ⋯ 더보기: 메모 목록 · 빠른 색상 · 단축키 도움말 · 앱 종료 (창 밖까지 펼쳐지는 기본 메뉴)
  btnMore.addEventListener('mousedown', (e) => e.preventDefault());
  btnMore.addEventListener('click', () => {
    rememberSelection();
    flushSave();
    const rect = btnMore.getBoundingClientRect();
    api.showMoreMenu({ x: Math.round(rect.left), y: Math.round(rect.bottom) });
  });
  api.onApplyQuickColor((index) => applyQuickColor(index));
  api.onQuickColors((list) => { quickColors = Array.isArray(list) ? list : []; });

  // -------------------------------------------------------------------------
  // 항상 위 고정
  // -------------------------------------------------------------------------
  let pinned = true;
  function renderPin() {
    btnPin.classList.toggle('active', pinned);
    btnPin.title = pinned ? '항상 위에 고정: 켜짐 (클릭하여 끄기)' : '항상 위에 고정: 꺼짐 (클릭하여 켜기)';
  }
  btnPin.addEventListener('click', () => {
    pinned = !pinned;
    renderPin();
    api.setPinned(pinned);
  });

  // -------------------------------------------------------------------------
  // 내용 접기: 창 높이를 제목줄만큼 줄여 뒤쪽 화면을 클릭할 수 있게 함 (항상 위 고정은 유지)
  // -------------------------------------------------------------------------
  let collapsed = false;
  function renderCollapsed() {
    document.body.classList.toggle('collapsed', collapsed);
    btnCollapse.title = collapsed ? '내용 펼치기' : '내용 접기 (제목줄만 남기고 맨 위에 유지)';
  }
  function setCollapsed(flag) {
    collapsed = Boolean(flag);
    renderCollapsed();
    api.setCollapsed(collapsed);
    if (!collapsed) editor.focus();
  }
  btnCollapse.addEventListener('click', () => setCollapsed(!collapsed));

  // -------------------------------------------------------------------------
  // 표시 설정: 배경 불투명도 / 글자 크기 / 기본 글자색 / 메모지 색
  // -------------------------------------------------------------------------
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const isHex = (v) => /^#[0-9a-fA-F]{6}$/.test(v);
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }

  function renderSettings() {
    const root = document.documentElement.style;
    root.setProperty('--paper-alpha', String(settings.bgOpacity));
    root.setProperty('--paper-rgb', hexToRgb(settings.paperColor));
    root.setProperty('--ink', settings.textColor);
    root.setProperty('--font-size', settings.fontSize + 'px');

    const pct = Math.round(settings.bgOpacity * 100);
    bgOpacityInput.value = String(pct);
    bgOpacityValue.textContent = pct + '%';
    fontSizeInput.value = String(settings.fontSize);
    fontSizeValue.textContent = settings.fontSize + 'px';
    textColorInput.value = settings.textColor;
    paperColorInput.value = settings.paperColor;
  }

  function updateSettings(partial, notify = true) {
    const next = { ...settings };
    if (typeof partial.bgOpacity === 'number') next.bgOpacity = Math.round(clamp(partial.bgOpacity, 0, 1) * 100) / 100;
    if (typeof partial.fontSize === 'number') next.fontSize = Math.round(clamp(partial.fontSize, 8, 48));
    if (isHex(partial.textColor || '')) next.textColor = partial.textColor;
    if (isHex(partial.paperColor || '')) next.paperColor = partial.paperColor;
    settings = next;
    renderSettings();
    if (notify) api.setSettings(settings);
  }

  btnSettings.addEventListener('click', () => {
    settingsPanel.hidden = !settingsPanel.hidden;
    btnSettings.classList.toggle('active', !settingsPanel.hidden);
  });
  bgOpacityInput.addEventListener('input', () => updateSettings({ bgOpacity: Number(bgOpacityInput.value) / 100 }));
  fontSizeInput.addEventListener('input', () => updateSettings({ fontSize: Number(fontSizeInput.value) }));
  textColorInput.addEventListener('input', () => updateSettings({ textColor: textColorInput.value }));
  paperColorInput.addEventListener('input', () => updateSettings({ paperColor: paperColorInput.value }));
  btnReset.addEventListener('click', () => updateSettings({ ...DEFAULTS }));

  // -------------------------------------------------------------------------
  // 창 크기 조절 (투명 창은 OS 테두리 리사이즈가 불안정하므로 직접 처리)
  // -------------------------------------------------------------------------
  const MIN_W = 260; // main.js 의 MIN_WIDTH 와 같게
  document.querySelectorAll('.rs').forEach((handle) => {
    handle.addEventListener('pointerdown', async (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const start = await api.getBounds();
      if (!start) return;
      const dir = handle.dataset.dir;
      const sx = e.screenX;
      const sy = e.screenY;
      handle.setPointerCapture(e.pointerId);
      let pending = null;

      const onMove = (ev) => {
        const dx = ev.screenX - sx;
        const dy = ev.screenY - sy;
        const b = { ...start };
        if (dir.includes('e')) b.width = Math.max(MIN_W, start.width + dx);
        if (dir.includes('s')) b.height = Math.max(160, start.height + dy);
        if (dir.includes('w')) {
          b.width = Math.max(MIN_W, start.width - dx);
          b.x = start.x + (start.width - b.width);
        }
        if (dir.includes('n')) {
          b.height = Math.max(160, start.height - dy);
          b.y = start.y + (start.height - b.height);
        }
        pending = b;
        if (!onMove.raf) {
          onMove.raf = requestAnimationFrame(() => {
            onMove.raf = 0;
            if (pending) api.setBounds(pending);
          });
        }
      };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        if (pending) api.setBounds(pending);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  });

  // -------------------------------------------------------------------------
  // 초기화
  // -------------------------------------------------------------------------
  async function init() {
    const state = await api.getState();
    if (state.content) editor.innerHTML = state.content;
    if (repairToggles()) scheduleSave(); // 예전 버전에서 깨진 채 저장된 토글 복구
    ensureNotEmpty();
    pinned = state.pinned !== false;
    renderPin();
    collapsed = state.collapsed === true;
    renderCollapsed();
    updateSettings({ ...DEFAULTS, ...(state.settings || {}) }, false);
    quickColors = Array.isArray(state.quickColors) ? state.quickColors : [];
    editor.focus();
  }
  init();

  // 테스트용 훅 (브라우저 테스트에서만 사용)
  window.__memoTest = { insertToggleAtCaret, toggleBold, updateSettings, getSettings: () => settings, applyQuickColor, insertBlocks };
})();
