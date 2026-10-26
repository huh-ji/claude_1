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
  const colorTextInput = document.getElementById('color-text');
  const colorHiliteInput = document.getElementById('color-hilite');

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

  // 현재 줄을 토글 블록으로 변환 (줄 내용 → 토글 제목)
  function convertLineToToggle(line, titleText) {
    const toggle = createToggle(titleText != null ? titleText : line.textContent.trim());
    line.replaceWith(toggle);
    const titleEl = toggle.querySelector('.toggle-title');
    if (titleEl.textContent) {
      const tn = firstTextNode(titleEl);
      setCaret(tn, tn.length);
    } else {
      caretToStart(titleEl);
    }
    scheduleSave();
    return toggle;
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

    if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleBold();
      return;
    }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      flushSave();
      api.newNote();
      return;
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      insertToggleAtCaret();
      return;
    }
    if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      updateSettings({ bgOpacity: settings.bgOpacity + (e.key === 'ArrowUp' ? 0.05 : -0.05) });
      return;
    }
    if (mod && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      updateSettings({ fontSize: settings.fontSize + 1 });
      return;
    }
    if (mod && e.key === '-') {
      e.preventDefault();
      updateSettings({ fontSize: settings.fontSize - 1 });
      return;
    }
    if (mod && e.key === '0') {
      e.preventDefault();
      updateSettings({ fontSize: DEFAULTS.fontSize });
      return;
    }

    const r = getRange();
    if (!r) return;
    const line = getLineBlock(r.startContainer);
    if (!line) return;

    // "> " 입력 → 토글 블록
    if (e.key === ' ' && r.collapsed && !line.classList.contains('toggle-title')) {
      const pre = r.cloneRange();
      pre.setStart(line, 0);
      if (pre.toString() === '>' && line.textContent === '>') {
        e.preventDefault();
        convertLineToToggle(line, '');
        return;
      }
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

    // 빈 토글 제목에서 Backspace → 토글 해제 (본문도 비어 있을 때)
    if (e.key === 'Backspace' && line.classList.contains('toggle-title') && r.collapsed) {
      const toggle = line.closest('.toggle');
      const body = toggle.querySelector('.toggle-body');
      const pre = r.cloneRange();
      pre.setStart(line, 0);
      if (pre.toString() === '' && isEmptyBlock(line) && isEmptyBlock(body)) {
        e.preventDefault();
        const plain = makeLine('');
        toggle.replaceWith(plain);
        setCaret(plain, 0);
        scheduleSave();
        return;
      }
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

  // 붙여넣기는 서식 없는 텍스트로
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  editor.addEventListener('input', () => {
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

  // 색상 선택기를 열면 에디터 포커스가 빠지므로, 열기 직전의 선택 영역을 기억했다가 복원
  let savedRange = null;
  function rememberSelection() {
    const r = getRange();
    savedRange = r ? r.cloneRange() : null;
  }
  function restoreSelection() {
    editor.focus();
    if (!savedRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
  function applySelectionColor(command, color) {
    restoreSelection();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, color);
    rememberSelection();
    scheduleSave();
  }
  function wireColorTool(input, command) {
    const label = input.closest('.color-tool');
    const setSwatch = () => label.style.setProperty('--swatch', input.value);
    setSwatch();
    input.addEventListener('pointerdown', rememberSelection);
    input.addEventListener('focus', () => { if (!savedRange) rememberSelection(); });
    input.addEventListener('input', () => { setSwatch(); applySelectionColor(command, input.value); });
  }
  wireColorTool(colorTextInput, 'foreColor');
  wireColorTool(colorHiliteInput, 'hiliteColor');

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
    ensureNotEmpty();
    pinned = state.pinned !== false;
    renderPin();
    collapsed = state.collapsed === true;
    renderCollapsed();
    updateSettings({ ...DEFAULTS, ...(state.settings || {}) }, false);
    editor.focus();
  }
  init();

  // 테스트용 훅 (브라우저 테스트에서만 사용)
  window.__memoTest = { insertToggleAtCaret, toggleBold, updateSettings, getSettings: () => settings };
})();
