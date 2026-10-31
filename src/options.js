'use strict';

(function () {
  const api = window.memo || {
    getQuickColors: async () => ({ list: [], defaults: [], max: 9 }),
    setQuickColors: () => {},
    onOptionsTab: () => {},
  };
  const listEl = document.getElementById('qc-list');
  const btnAdd = document.getElementById('qc-add');
  const btnReset = document.getElementById('qc-reset');
  const helpQuick = document.getElementById('help-quick');
  const isHex = (v) => /^#[0-9a-fA-F]{6}$/.test(v);

  let list = [];
  let defaults = [];
  let max = 9;

  // --- 탭 ---
  function showTab(tab) {
    const name = tab === 'help' ? 'help' : 'colors';
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    document.getElementById('tab-colors').hidden = name !== 'colors';
    document.getElementById('tab-help').hidden = name !== 'help';
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  api.onOptionsTab(showTab);
  showTab(new URLSearchParams(location.search).get('tab'));

  // --- 저장 ---
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api.setQuickColors(list.filter((q) => isHex(q.color))), 200);
    renderHelp();
  }

  function el(tag, props = {}, children = []) {
    const e = document.createElement(tag);
    Object.assign(e, props);
    children.forEach((c) => e.append(c));
    return e;
  }

  function updatePreview(preview, q) {
    preview.style.color = q.type === 'text' && isHex(q.color) ? q.color : '';
    preview.style.background = q.type === 'bg' && isHex(q.color) ? q.color : '';
  }

  // --- 빠른 색상 목록 ---
  function render() {
    listEl.innerHTML = '';
    list.forEach((q, i) => {
      const key = el('span', { className: 'qc-key' });
      key.innerHTML = `<kbd>Ctrl</kbd>+<kbd>${i + 1}</kbd>`;

      const type = el('select', { title: '글자색 / 배경색' }, [
        el('option', { value: 'text', textContent: '글자색' }),
        el('option', { value: 'bg', textContent: '배경색' }),
      ]);
      type.value = q.type;

      const color = el('input', { type: 'color', value: q.color, title: '색 고르기' });
      const hex = el('input', { type: 'text', value: q.color, maxLength: 7, title: '색상 코드 (#rrggbb)', spellcheck: false });
      const name = el('input', { type: 'text', value: q.name, maxLength: 20, placeholder: '이름', title: '메뉴에 보일 이름' });
      const preview = el('span', { className: 'qc-preview', textContent: '가나다 Abc' });
      updatePreview(preview, q);

      const up = el('button', { className: 'icon-btn', textContent: '↑', title: '위로 (번호 앞당기기)', disabled: i === 0 });
      const down = el('button', { className: 'icon-btn', textContent: '↓', title: '아래로', disabled: i === list.length - 1 });
      const del = el('button', { className: 'icon-btn', textContent: '✕', title: '삭제' });

      type.addEventListener('change', () => { q.type = type.value; updatePreview(preview, q); save(); });
      color.addEventListener('input', () => {
        q.color = color.value; hex.value = color.value; hex.classList.remove('bad'); updatePreview(preview, q); save();
      });
      hex.addEventListener('input', () => {
        let v = hex.value.trim();
        if (v && v[0] !== '#') v = '#' + v;
        const ok = isHex(v);
        hex.classList.toggle('bad', !ok);
        if (ok) { q.color = v.toLowerCase(); color.value = q.color; updatePreview(preview, q); save(); }
      });
      name.addEventListener('input', () => { q.name = name.value; save(); });
      up.addEventListener('click', () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; render(); save(); });
      down.addEventListener('click', () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; render(); save(); });
      del.addEventListener('click', () => { list.splice(i, 1); render(); save(); });

      listEl.append(el('li', { className: 'qc-row' }, [key, type, color, hex, name, preview, el('span', { className: 'qc-buttons' }, [up, down, del])]));
    });
    btnAdd.disabled = list.length >= max;
    btnAdd.title = list.length >= max ? `최대 ${max}개 (Ctrl+1 ~ Ctrl+${max})` : '';
  }

  function renderHelp() {
    helpQuick.innerHTML = '';
    if (!list.length) {
      helpQuick.innerHTML = '<tr><td><kbd>Ctrl</kbd>+<kbd>1</kbd>~<kbd>9</kbd></td><td>빠른 색상 (지정된 색 없음 · 빠른 색상 탭에서 추가)</td></tr>';
      return;
    }
    list.forEach((q, i) => {
      const tr = document.createElement('tr');
      const k = document.createElement('td');
      k.innerHTML = `<kbd>Ctrl</kbd>+<kbd>${i + 1}</kbd>`;
      const d = document.createElement('td');
      const sample = document.createElement('span');
      sample.className = 'qc-preview';
      sample.textContent = q.name || q.color;
      updatePreview(sample, q);
      d.append(sample, ` ${q.type === 'bg' ? '배경색' : '글자색'} ${q.color}`);
      tr.append(k, d);
      helpQuick.append(tr);
    });
  }

  btnAdd.addEventListener('click', () => {
    if (list.length >= max) return;
    list.push({ type: 'text', color: '#7048e8', name: '' });
    render();
    save();
  });
  btnReset.addEventListener('click', () => {
    list = defaults.map((q) => ({ ...q }));
    render();
    save();
  });

  api.getQuickColors().then((res) => {
    list = (res.list || []).map((q) => ({ ...q }));
    defaults = res.defaults || [];
    max = res.max || 9;
    render();
    renderHelp();
  });
})();
