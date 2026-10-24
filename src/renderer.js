'use strict';

(function () {
  const editor = document.getElementById('editor');
  const btnBold = document.getElementById('btn-bold');
  const btnToggle = document.getElementById('btn-toggle');
  const btnPin = document.getElementById('btn-pin');
  const btnMin = document.getElementById('btn-min');
  const btnClose = document.getElementById('btn-close');
  const opacityInput = document.getElementById('opacity');
  const opacityValue = document.getElementById('opacity-value');

  // Electron 밖(브라우저 테스트)에서도 동작하도록 안전한 대체 API
  const api = window.memo || {
    getState: async () => ({ content: '', opacity: 0.92, pinned: true, platform: 'web' }),
    saveContent: () => {},
    setOpacity: () => {},
    setPinned: () => {},
    minimize: () => {},
    close: () => {},
  };

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
    if (mod && e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      insertToggleAtCaret();
      return;
    }
    if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      nudgeOpacity(e.key === 'ArrowUp' ? 5 : -5);
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
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      api.saveContent(editor.innerHTML);
    }, 300);
  }
  window.addEventListener('beforeunload', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      api.saveContent(editor.innerHTML);
    }
  });

  // -------------------------------------------------------------------------
  // 툴바
  // -------------------------------------------------------------------------
  btnBold.addEventListener('mousedown', (e) => e.preventDefault()); // 포커스 유지
  btnBold.addEventListener('click', toggleBold);
  btnToggle.addEventListener('mousedown', (e) => e.preventDefault());
  btnToggle.addEventListener('click', insertToggleAtCaret);
  btnMin.addEventListener('click', () => api.minimize());
  btnClose.addEventListener('click', () => api.close());

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

  function applyOpacity(percent, notify = true) {
    const p = Math.round(Math.min(100, Math.max(15, percent)));
    opacityInput.value = String(p);
    opacityValue.textContent = p + '%';
    if (notify) api.setOpacity(p / 100);
  }
  function nudgeOpacity(delta) {
    applyOpacity(Number(opacityInput.value) + delta);
  }
  opacityInput.addEventListener('input', () => applyOpacity(Number(opacityInput.value)));

  // -------------------------------------------------------------------------
  // 초기화
  // -------------------------------------------------------------------------
  async function init() {
    const state = await api.getState();
    if (state.content) editor.innerHTML = state.content;
    ensureNotEmpty();
    pinned = state.pinned !== false;
    renderPin();
    applyOpacity(Math.round((state.opacity || 0.92) * 100), false);

    if (state.platform === 'linux') {
      opacityInput.title = 'Linux에서는 창 투명도가 지원되지 않을 수 있습니다';
    }
    editor.focus();
  }
  init();

  // 테스트용 훅 (브라우저 테스트에서만 사용)
  window.__memoTest = { insertToggleAtCaret, toggleBold, applyOpacity };
})();
