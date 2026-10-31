'use strict';

// ---------------------------------------------------------------------------
// 붙여넣기 정리: 다른 곳(Notion, 웹, Word, Google Docs 등)에서 복사한 HTML 을
// 메모가 지원하는 형식(줄 div / 토글 블록 / 굵게·기울임·밑줄·취소선 / 글자색·배경색)으로 바꾼다.
// 글꼴·크기·여백 같은 나머지 서식은 버려서 글자가 겹치거나 한 줄로 뭉치는 일을 막는다.
// ---------------------------------------------------------------------------
(function () {
  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE',
    'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN',
    'NAV', 'ASIDE', 'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD', 'ADDRESS', 'HR', 'DETAILS', 'SUMMARY',
    'CENTER', 'FORM', 'FIELDSET',
  ]);
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'NOSCRIPT', 'TEMPLATE', 'IMG', 'SVG',
    'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'EMBED', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'CANVAS',
    'MATH', 'PICTURE', 'SOURCE',
  ]);
  const NBSP = ' ';
  const INDENT = NBSP.repeat(4);

  // Notion 의 색 클래스 (내보내기/복사 HTML 에서 쓰임)
  const NOTION_TEXT = {
    gray: '#787774', brown: '#9f6b53', orange: '#d9730d', yellow: '#cb912f', green: '#448361',
    teal: '#448361', blue: '#337ea9', purple: '#9065b0', pink: '#c14c8a', red: '#d44c47',
  };
  const NOTION_BG = {
    gray: '#f1f1ef', brown: '#f4eeee', orange: '#fbecdd', yellow: '#fbf3db', green: '#edf3ec',
    teal: '#edf3ec', blue: '#e7f3f8', purple: '#f6f3f9', pink: '#faf1f5', red: '#fdebec',
  };

  // --- 색 정규화 -----------------------------------------------------------
  const ctx = document.createElement('canvas').getContext('2d');
  function normalizeColor(value) {
    if (!value) return null;
    const v = String(value).trim().toLowerCase();
    if (!v || v === 'inherit' || v === 'initial' || v === 'unset' || v === 'currentcolor' ||
        v === 'transparent' || v.startsWith('var(') || v === 'windowtext' || v === 'window' ||
        v === 'auto') return null;
    ctx.fillStyle = '#010203';
    ctx.fillStyle = v;
    const out = ctx.fillStyle;
    if (out === '#010203' && v !== '#010203') return null; // 해석할 수 없는 값
    const m = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(out);
    if (m && Number(m[4]) === 0) return null; // 완전 투명
    return out;
  }
  const isBlackish = (c) => c === '#000000';
  const isWhiteish = (c) => c === '#ffffff';

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // --- 요소 하나가 서식에 주는 영향 ---------------------------------------
  function formatFor(el, parent) {
    const f = { ...parent };
    const tag = el.tagName;
    const st = el.style || {};

    if (tag === 'B' || tag === 'STRONG') f.bold = true;
    if (/^H[1-3]$/.test(tag) || tag === 'TH' || tag === 'DT' || tag === 'SUMMARY') f.bold = true;
    if (tag === 'I' || tag === 'EM' || tag === 'CITE') f.italic = true;
    if (tag === 'U' || tag === 'INS') f.underline = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') f.strike = true;
    if (tag === 'MARK') f.bg = '#ffec99';
    const colorAttr = el.getAttribute && el.getAttribute('color');
    if (colorAttr) {
      const named = /^([a-z]+?)(?:_(background|bg))?$/.exec(colorAttr.trim().toLowerCase());
      if (named && (NOTION_TEXT[named[1]] || named[1] === 'default')) {
        // Notion 색 이름 (default, gray, brown, orange, yellow, green, blue, purple, pink, red, *_background)
        if (named[1] === 'default') { f.color = null; f.bg = null; }
        else if (named[2]) f.bg = NOTION_BG[named[1]];
        else f.color = NOTION_TEXT[named[1]];
      } else if (tag === 'FONT') {
        const c = normalizeColor(colorAttr);
        if (c && !isBlackish(c)) f.color = c;
      }
    }

    // 인라인 style (Google Docs 는 <b style="font-weight:normal"> 로 전체를 감싸므로 normal 을 존중)
    const fw = st.fontWeight;
    if (fw) {
      if (fw === 'bold' || fw === 'bolder' || Number(fw) >= 600) f.bold = true;
      else if (fw === 'normal' || fw === 'lighter' || Number(fw) < 600) f.bold = false;
    }
    if (st.fontStyle === 'italic' || st.fontStyle === 'oblique') f.italic = true;
    else if (st.fontStyle === 'normal') f.italic = false;
    const deco = `${st.textDecoration || ''} ${st.textDecorationLine || ''}`;
    if (deco.includes('underline')) f.underline = true;
    if (deco.includes('line-through')) f.strike = true;
    if (st.color) {
      const c = normalizeColor(st.color);
      if (c && !isBlackish(c)) f.color = c;
      else if (c) f.color = null; // 검정은 기본 글자색으로 (어두운 메모지에서도 보이도록)
    }
    const bgRaw = st.backgroundColor || (st.background && !/url\(/.test(st.background) ? st.background : '');
    if (bgRaw) {
      const c = normalizeColor(bgRaw);
      if (c && !isWhiteish(c)) f.bg = c;
      else f.bg = null;
    }

    // Notion 색 클래스: highlight-red, highlight-yellow_background, block-color-blue 등
    for (const cls of el.classList || []) {
      const m = /^(?:highlight|block-color|color)-([a-z]+?)(_background)?$/.exec(cls);
      if (!m) continue;
      if (m[2] && NOTION_BG[m[1]]) f.bg = NOTION_BG[m[1]];
      else if (!m[2] && NOTION_TEXT[m[1]]) f.color = NOTION_TEXT[m[1]];
    }
    return f;
  }

  function wrapInline(text, f) {
    let html = escapeHtml(text);
    const styles = [];
    if (f.color) styles.push(`color: ${f.color};`);
    if (f.bg) styles.push(`background-color: ${f.bg};`);
    if (styles.length) html = `<span style="${styles.join(' ')}">${html}</span>`;
    if (f.strike) html = `<s>${html}</s>`;
    if (f.underline) html = `<u>${html}</u>`;
    if (f.italic) html = `<i>${html}</i>`;
    if (f.bold) html = `<b>${html}</b>`;
    return html;
  }

  // --- 블록 만들기 ---------------------------------------------------------
  // block = { type: 'line', html } | { type: 'toggle', title, open, children: [block] }
  function createBuilder() {
    const blocks = [];
    let parts = []; // 현재 줄의 인라인 HTML 조각
    let lastChar = ''; // 현재 줄에 마지막으로 넣은 글자 (공백 정리용)
    let pendingPrefix = ''; // 목록 기호 등, 줄의 첫 글자 앞에 붙일 것

    function emitRaw(html, plainText) {
      if (pendingPrefix) {
        parts.push(escapeHtml(pendingPrefix));
        pendingPrefix = '';
      }
      parts.push(html);
      if (plainText) lastChar = plainText[plainText.length - 1];
    }
    return {
      blocks,
      hasContent: () => parts.length > 0,
      text(text, f, pre) {
        let t = text;
        if (pre) {
          t = t.replace(/\t/g, INDENT).replace(/ /g, NBSP);
        } else {
          t = t.replace(/[\t\n\r\f ]+/g, ' ');
          if (parts.length === 0 || lastChar === ' ' || lastChar === NBSP) t = t.replace(/^ /, '');
        }
        if (!t) return;
        emitRaw(wrapInline(t, f), t);
      },
      prefix(p) { pendingPrefix = p; },
      flush(force) {
        if (parts.length === 0 && !force && !pendingPrefix) return;
        if (pendingPrefix && parts.length === 0) {
          if (!force) { pendingPrefix = ''; return; }
        }
        let html = parts.join('');
        html = html.replace(/(?:&nbsp;| )+$/, '').replace(/\s+$/, '');
        blocks.push({ type: 'line', html });
        parts = [];
        lastChar = '';
        pendingPrefix = '';
      },
      push(block) {
        this.flush();
        blocks.push(block);
      },
    };
  }

  function walkChildren(node, b, f, ctxt) {
    for (const child of Array.from(node.childNodes)) walk(child, b, f, ctxt);
  }

  function walk(node, b, f, ctxt) {
    if (node.nodeType === 3) {
      b.text(node.nodeValue, f, ctxt.pre);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node;
    const tag = el.tagName;
    if (SKIP_TAGS.has(tag)) return;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return;
    const st = el.style || {};
    if (st.display === 'none') return;

    if (tag === 'BR') {
      if (b.hasContent()) b.flush();
      else b.flush(true); // 빈 줄
      return;
    }
    if (tag === 'HR') {
      b.flush();
      b.push({ type: 'line', html: '────────' });
      return;
    }

    const nf = formatFor(el, f);

    if (tag !== 'DETAILS' && el.classList && el.classList.contains('notion-toggle')) {
      b.flush();
      const content = el.querySelector('.notion-toggle-content, .notion-toggle-details');
      const head = el.cloneNode(true);
      head.querySelectorAll('.notion-toggle-content, .notion-toggle-details, .notion-toggle-button-arrow, svg').forEach((x) => x.remove());
      const titleB = createBuilder();
      walkChildren(head, titleB, nf, ctxt);
      titleB.flush();
      const title = titleB.blocks.filter((x) => x.type === 'line').map((x) => x.html).filter(Boolean).join(' ')
        .replace(/^(?:[\s\u00a0▶▸►▼▾]|&nbsp;)+/, '');
      const bodyB = createBuilder();
      if (content) walkChildren(content, bodyB, nf, { ...ctxt, listDepth: 0, list: null });
      bodyB.flush();
      b.push({ type: 'toggle', title, open: true, children: bodyB.blocks });
      return;
    }

    if (tag === 'DETAILS') {
      b.flush();
      const summary = Array.from(el.children).find((c) => c.tagName === 'SUMMARY');
      const titleB = createBuilder();
      if (summary) walkChildren(summary, titleB, { ...nf, bold: f.bold }, ctxt);
      titleB.flush();
      const title = titleB.blocks.filter((x) => x.type === 'line').map((x) => x.html).filter(Boolean).join(' ');
      const bodyB = createBuilder();
      for (const child of Array.from(el.childNodes)) {
        if (child === summary) continue;
        walk(child, bodyB, nf, { ...ctxt, listDepth: 0, list: null });
      }
      bodyB.flush();
      // 접힌 채로 들어오면 내용이 사라진 것처럼 보이므로 붙여넣은 토글은 펼쳐 둔다
      b.push({ type: 'toggle', title, open: true, children: bodyB.blocks });
      return;
    }

    if (tag === 'UL' || tag === 'OL') {
      b.flush();
      const depth = (ctxt.listDepth || 0) + 1;
      let index = Number(el.getAttribute('start')) || 1;
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === 1 && child.tagName === 'LI') {
          walk(child, b, nf, { ...ctxt, listDepth: depth, list: { ordered: tag === 'OL', index } });
          index += 1;
        } else {
          walk(child, b, nf, { ...ctxt, listDepth: depth, list: null });
        }
      }
      b.flush();
      return;
    }

    if (tag === 'LI') {
      b.flush();
      const firstEl = Array.from(el.children)[0];
      const onlyDetails = firstEl && firstEl.tagName === 'DETAILS' && el.textContent.trim() === firstEl.textContent.trim();
      if (!onlyDetails) {
        const depth = Math.max(1, ctxt.listDepth || 1);
        const indent = INDENT.repeat(depth - 1);
        let mark = depth > 1 ? '◦ ' : '• ';
        if (ctxt.list && ctxt.list.ordered) mark = `${ctxt.list.index}. `;
        // 체크박스 목록 (Notion 할 일 등)
        const box = el.querySelector(':scope > input[type="checkbox"], :scope > .checkbox, :scope > span > input[type="checkbox"]');
        if (box) mark = (box.checked || box.classList.contains('checkbox-on') ? '☑ ' : '☐ ');
        b.prefix(indent + mark);
      }
      walkChildren(el, b, nf, { ...ctxt, list: null });
      b.flush();
      return;
    }

    if (tag === 'TD' || tag === 'TH') {
      if (b.hasContent()) b.text(' | ', f, true);
      walkChildren(el, b, nf, ctxt);
      return;
    }

    if (tag === 'PRE') {
      b.flush();
      const preB = createBuilder();
      walkPre(el, preB, nf);
      preB.flush();
      preB.blocks.forEach((blk) => b.push(blk));
      return;
    }

    const isBlock = BLOCK_TAGS.has(tag) || st.display === 'block' || st.display === 'list-item' || st.display === 'flex';
    if (isBlock) {
      b.flush();
      walkChildren(el, b, nf, ctxt);
      b.flush();
      return;
    }
    walkChildren(el, b, nf, ctxt); // 인라인 요소
  }

  // <pre> 안은 공백과 줄바꿈을 그대로 살린다
  function walkPre(node, b, f) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        const lines = child.nodeValue.replace(/\r\n?/g, '\n').split('\n');
        lines.forEach((line, i) => {
          if (i > 0) b.flush(true);
          b.text(line, f, true);
        });
      } else if (child.nodeType === 1) {
        if (child.tagName === 'BR') b.flush(true);
        else walkPre(child, b, formatFor(child, f));
      }
    }
  }

  // 앞뒤의 빈 줄은 버린다
  function trimBlocks(blocks) {
    const isEmpty = (blk) => blk.type === 'line' && !blk.html;
    while (blocks.length && isEmpty(blocks[0])) blocks.shift();
    while (blocks.length && isEmpty(blocks[blocks.length - 1])) blocks.pop();
    return blocks;
  }

  function fromHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const b = createBuilder();
    walkChildren(doc.body, b, {}, { pre: false, listDepth: 0, list: null });
    b.flush();
    return trimBlocks(b.blocks);
  }

  function fromText(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = lines.map((line) => {
      const m = /^[\t ]*/.exec(line)[0];
      // 탭과 두 칸 이상의 공백만 들여쓰기로 살린다 (한 칸은 일반 공백 그대로)
      const lead = m === ' ' ? ' ' : m.replace(/\t/g, INDENT).replace(/ /g, NBSP);
      return { type: 'line', html: escapeHtml(lead + line.slice(m.length)).replace(/ {2,}/g, (s) => NBSP.repeat(s.length)) };
    });
    return trimBlocks(blocks);
  }

  // --- Notion 마크다운 (텍스트로 들어온 경우) -----------------------------
  //   토글:        <details color="..."><summary>제목</summary> + 들여쓴 내용 + </details>
  //   토글 제목:   ## 제목 {toggle="true"}  + 들여쓴 내용
  const INLINE_TAG = /<\/?(?:span|b|strong|i|em|u|s|del|mark|br)\b[^>]*>/gi;
  function mdInline(t) {
    const kept = [];
    let out = t.replace(INLINE_TAG, (m) => { kept.push(m); return '\u0000' + (kept.length - 1) + '\u0000'; });
    out = escapeHtml(out)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/__(.+?)__/g, '<b>$1</b>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>')
      .replace(/~~(.+?)~~/g, '<s>$1</s>')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    return out.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)]);
  }

  function looksLikeNotionMarkdown(text) {
    const t = String(text || '');
    return (/<details[\s>]/i.test(t) && /<summary>/i.test(t)) || /\{toggle="true"\}/.test(t);
  }

  function fromNotionMarkdown(text) {
    const out = [];
    const openHeadings = []; // 토글 제목의 들여쓰기 깊이
    let detailsDepth = 0; // 열린 <details> 수 (토글 안 들여쓰기는 구조이므로 화면 들여쓰기에서 뺀다)
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    for (const raw of lines) {
      const m = /^([\t ]*)(.*)$/.exec(raw);
      const indent = m[1].replace(/\t/g, '    ').length;
      const body = m[2].trimEnd();
      if (!body) { out.push('<p><br></p>'); continue; }
      while (openHeadings.length && indent <= openHeadings[openHeadings.length - 1]) {
        out.push('</details>');
        openHeadings.pop();
      }
      const th = /^(#{1,3})\s+(.*?)\s*\{toggle="true"\}\s*$/.exec(body);
      if (th) {
        out.push(`<details><summary>${mdInline(th[2])}</summary>`);
        openHeadings.push(indent);
        continue;
      }
      if (/^<\/?(?:details|summary)\b/i.test(body)) {
        detailsDepth += (body.match(/<details\b/gi) || []).length - (body.match(/<\/details>/gi) || []).length;
        detailsDepth = Math.max(0, detailsDepth);
        out.push(body.replace(/<summary>([\s\S]*?)<\/summary>/i, (_, t) => `<summary>${mdInline(t)}</summary>`));
        continue;
      }
      const level = Math.max(0, Math.floor(indent / 4) - detailsDepth - openHeadings.length);
      const pad = NBSP.repeat(4 * level);
      let mm;
      if ((mm = /^#{1,6}\s+(.*)$/.exec(body))) out.push(`<p><b>${mdInline(mm[1])}</b></p>`);
      else if ((mm = /^[-*+]\s+\[( |x|X)\]\s+(.*)$/.exec(body))) out.push(`<p>${pad}${mm[1] === ' ' ? '☐' : '☑'} ${mdInline(mm[2])}</p>`);
      else if ((mm = /^[-*+]\s+(.*)$/.exec(body))) out.push(`<p>${pad}${level ? '◦' : '•'} ${mdInline(mm[1])}</p>`);
      else if ((mm = /^>\s?(.*)$/.exec(body))) out.push(`<p>${pad}${mdInline(mm[1])}</p>`);
      else out.push(`<p>${pad}${mdInline(body)}</p>`);
    }
    while (openHeadings.length) { out.push('</details>'); openHeadings.pop(); }
    return fromHtml(out.join(''));
  }

  // 붙여넣기 진입점: HTML 을 우선 쓰되, 토글이 HTML 로 안 왔는데 텍스트가 Notion 마크다운이면 텍스트를 해석
  function fromClipboard(html, text) {
    const notionMd = looksLikeNotionMarkdown(text);
    if (html) {
      const blocks = fromHtml(html);
      const hasToggle = blocks.some((x) => x.type === 'toggle');
      if (blocks.length && (hasToggle || !notionMd)) return blocks;
    }
    return notionMd ? fromNotionMarkdown(text) : fromText(text);
  }

  function renderBlocks(blocks) {
    return blocks.map((blk) => {
      if (blk.type === 'toggle') {
        const children = blk.children && blk.children.length ? blk.children : [{ type: 'line', html: '' }];
        return '<div class="toggle" data-open="' + (blk.open ? 'true' : 'false') + '">' +
          '<span class="toggle-arrow" contenteditable="false" title="펼치기/접기"></span>' +
          '<div class="toggle-title">' + (blk.title || '') + '</div>' +
          '<div class="toggle-body">' + renderBlocks(children) + '</div></div>';
      }
      return '<div>' + (blk.html || '<br>') + '</div>';
    }).join('');
  }

  window.MemoPaste = { fromHtml, fromText, fromClipboard, fromNotionMarkdown, renderBlocks, normalizeColor };
})();
