'use strict';

const {
  app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, dialog, nativeImage,
} = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// 상수 / 기본값
// ---------------------------------------------------------------------------
const STATE_FILE = () => path.join(app.getPath('userData'), 'state.json');

const MIN_WIDTH = 260; // 제목줄 버튼이 모두 들어가는 최소 너비
const MIN_HEIGHT = 160;
const COLLAPSED_HEIGHT = 36; // 제목줄(34px) + 테두리
const CASCADE = 30; // 새 메모를 기존 메모에서 비켜 놓는 간격
const DEFAULT_BOUNDS = { width: 360, height: 420 };

const DEFAULT_SETTINGS = {
  bgOpacity: 0.92, // 0(완전 투명) ~ 1(불투명) - 메모지 배경에만 적용, 글자는 항상 선명
  fontSize: 14, // px
  textColor: '#2b2b2b',
  paperColor: '#fff8c6',
};

// 빠른 색상 (Ctrl+1 ~ Ctrl+9). 순서가 곧 단축키 번호. ⋯ → 빠른 색상 편집에서 바꿀 수 있음
const MAX_QUICK_COLORS = 9;
const DEFAULT_QUICK_COLORS = [
  { type: 'text', color: '#e03131', name: '빨간 글자' },
  { type: 'text', color: '#1971c2', name: '파란 글자' },
  { type: 'bg', color: '#ffec99', name: '노란 배경' },
  { type: 'text', color: '#2f9e44', name: '초록 글자' },
  { type: 'bg', color: '#ffc9c9', name: '분홍 배경' },
];

function sanitizeQuickColors(list) {
  if (!Array.isArray(list)) return DEFAULT_QUICK_COLORS.map((q) => ({ ...q }));
  return list
    .filter((q) => q && typeof q === 'object' && isHexColor(q.color))
    .slice(0, MAX_QUICK_COLORS)
    .map((q) => {
      const type = q.type === 'bg' ? 'bg' : 'text';
      const name = typeof q.name === 'string' && q.name.trim()
        ? q.name.trim().slice(0, 20)
        : (type === 'bg' ? '배경 ' : '글자 ') + q.color.toLowerCase();
      return { type, color: q.color.toLowerCase(), name };
    });
}

// ---------------------------------------------------------------------------
// 메모 데이터
//   state = { version: 2, notes: [note...], trayHintShown }
//   note  = { id, title, content, bounds(펼친 크기), pinned, collapsed, open, settings, createdAt, updatedAt }
//   open=false 는 ✕ 로 닫은 메모 (내용은 보존, 트레이에서 다시 열 수 있음)
// ---------------------------------------------------------------------------
const isHexColor = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function sanitizeSettings(base, input) {
  const s = { ...base };
  if (input && typeof input === 'object') {
    if (isNum(input.bgOpacity)) s.bgOpacity = Math.min(1, Math.max(0, input.bgOpacity));
    if (isNum(input.fontSize)) s.fontSize = Math.min(48, Math.max(8, Math.round(input.fontSize)));
    if (isHexColor(input.textColor)) s.textColor = input.textColor;
    if (isHexColor(input.paperColor)) s.paperColor = input.paperColor;
  }
  return s;
}

function makeNote(partial = {}) {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: '',
    content: '',
    bounds: { ...DEFAULT_BOUNDS },
    pinned: true,
    collapsed: false,
    open: true,
    settings: { ...DEFAULT_SETTINGS },
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

function normalizeNote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base = makeNote();
  const b = raw.bounds && typeof raw.bounds === 'object' ? raw.bounds : {};
  const content = typeof raw.content === 'string' ? raw.content : '';
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : base.id,
    title: typeof raw.title === 'string' ? raw.title : titleFromHtml(content),
    content,
    bounds: {
      ...(isNum(b.x) && isNum(b.y) ? { x: b.x, y: b.y } : {}),
      width: isNum(b.width) ? Math.max(MIN_WIDTH, b.width) : DEFAULT_BOUNDS.width,
      height: isNum(b.height) ? Math.max(MIN_HEIGHT, b.height) : DEFAULT_BOUNDS.height,
    },
    pinned: raw.pinned !== false,
    collapsed: raw.collapsed === true,
    open: raw.open !== false,
    settings: sanitizeSettings(DEFAULT_SETTINGS, raw.settings),
    createdAt: isNum(raw.createdAt) ? raw.createdAt : base.createdAt,
    updatedAt: isNum(raw.updatedAt) ? raw.updatedAt : base.updatedAt,
  };
}

// 저장된 HTML 에서 첫 줄 글자를 뽑아 메뉴 제목으로 사용 (렌더러가 보낸 제목이 없을 때의 대체값)
function titleFromHtml(html) {
  const text = String(html || '')
    .replace(/<(div|p|br)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
  const line = text.split('\n').map((l) => l.trim()).find(Boolean);
  return line ? line.slice(0, 60) : '';
}

const isEmptyNote = (note) => titleFromHtml(note.content) === '';

function loadState() {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
  } catch {
    raw = null;
  }
  if (raw && Array.isArray(raw.notes)) {
    const seen = new Set();
    const notes = raw.notes.map(normalizeNote).filter((n) => {
      if (!n || seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });
    return {
      version: 2,
      notes,
      trayHintShown: raw.trayHintShown === true,
      quickColors: sanitizeQuickColors(raw.quickColors),
    };
  }
  if (raw && typeof raw === 'object') {
    // 1.x 버전(메모 1개) 저장 형식 → 메모 1개짜리 목록으로 변환
    const settings = raw.settings || (isNum(raw.opacity) ? { bgOpacity: raw.opacity } : undefined);
    const note = normalizeNote({ ...raw, id: undefined, title: undefined, settings, open: true });
    return { version: 2, notes: [note], trayHintShown: false, quickColors: sanitizeQuickColors(null) };
  }
  return { version: 2, notes: [], trayHintShown: false, quickColors: sanitizeQuickColors(null) };
}

let state = null;
let saveTimer = null;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveStateNow, 250);
}

function saveStateNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!state) return;
  try {
    fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true });
    const tmp = STATE_FILE() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE()); // 쓰는 도중 꺼져도 기존 파일이 깨지지 않도록
  } catch (err) {
    console.error('상태 저장 실패:', err);
  }
}

const noteById = (id) => state.notes.find((n) => n.id === id) || null;

function removeNote(id) {
  state.notes = state.notes.filter((n) => n.id !== id);
  scheduleSave();
  refreshTrayMenu();
}

// ---------------------------------------------------------------------------
// 창 관리 (메모 1개 = 창 1개)
// ---------------------------------------------------------------------------
const windows = new Map(); // noteId -> BrowserWindow
const senderToNote = new Map(); // webContents.id -> noteId
let lastFocusedId = null;
let quitting = false;
let tray = null;

// 저장된 창 위치가 현재 연결된 모니터 안에 있는지 확인 (모니터 구성이 바뀐 경우 대비). 항상 복사본을 반환
function clampBounds(bounds) {
  const { width, height } = bounds;
  if (!isNum(bounds.x) || !isNum(bounds.y)) return { width, height };
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return (
      bounds.x + width > a.x + 40 &&
      bounds.x < a.x + a.width - 40 &&
      bounds.y + height > a.y + 40 &&
      bounds.y < a.y + a.height - 40
    );
  });
  return visible ? { x: bounds.x, y: bounds.y, width, height } : { width, height };
}

// 현재 창 크기를 note.bounds 에 기록. 접힌 상태에서는 높이를 건드리지 않아 펼칠 때 원래 높이로 돌아감
function rememberBounds(note, win) {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  const b = win.getBounds();
  note.bounds = note.collapsed ? { ...b, height: note.bounds.height } : b;
}

function applyAlwaysOnTop(win, flag) {
  // 'screen-saver' 레벨은 macOS에서 가장 높은 레벨, Windows/Linux에서는 일반 topmost 로 동작
  win.setAlwaysOnTop(flag, 'screen-saver');
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(flag, { visibleOnFullScreen: true });
  }
}

function setCollapsed(note, win, flag) {
  flag = Boolean(flag);
  if (!win || flag === note.collapsed) return;
  rememberBounds(note, win);
  note.collapsed = flag;
  const b = win.getBounds();
  if (flag) {
    win.setMinimumSize(MIN_WIDTH, COLLAPSED_HEIGHT);
    win.setBounds({ ...b, height: COLLAPSED_HEIGHT });
  } else {
    // 최소 크기를 먼저 바꾸면 그때 발생하는 resize 이벤트가 저장된 높이를 덮어쓰므로, 높이를 먼저 복원
    const height = Math.max(MIN_HEIGHT, note.bounds.height || DEFAULT_BOUNDS.height);
    win.setBounds({ ...b, height });
    win.setMinimumSize(MIN_WIDTH, MIN_HEIGHT);
  }
  scheduleSave();
}

function openNoteWindow(note, { focus = true } = {}) {
  const existing = windows.get(note.id);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    if (focus) {
      existing.show();
      existing.focus();
    } else {
      existing.showInactive();
    }
    return existing;
  }

  note.open = true;
  const bounds = clampBounds(note.bounds);
  if (note.collapsed) bounds.height = COLLAPSED_HEIGHT;

  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: note.collapsed ? COLLAPSED_HEIGHT : MIN_HEIGHT,
    maximizable: false, // 제목줄 더블클릭 / 화면 위로 끌기 시 최대화되지 않도록
    frame: false,
    transparent: true, // 배경 투명도 0까지 지원 (글자는 그대로 보임)
    hasShadow: false,
    show: false,
    alwaysOnTop: note.pinned,
    skipTaskbar: false,
    backgroundColor: '#00000000',
    title: 'FloatMemo',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  const contentsId = win.webContents.id;
  windows.set(note.id, win);
  senderToNote.set(contentsId, note.id);

  win.loadFile(path.join(__dirname, 'index.html'));

  win.once('ready-to-show', () => {
    applyAlwaysOnTop(win, note.pinned);
    if (focus) win.show();
    else win.showInactive();
  });

  const onBoundsChanged = () => {
    rememberBounds(note, win);
    scheduleSave();
  };
  win.on('resize', onBoundsChanged);
  win.on('move', onBoundsChanged);
  win.on('focus', () => {
    lastFocusedId = note.id;
  });

  // Windows 종료/로그오프 시에는 메모를 "닫힘"으로 표시하지 않음 (다음 실행 때 그대로 열리도록)
  const onSessionEnd = () => {
    quitting = true;
    saveStateNow();
  };
  win.on('query-session-end', onSessionEnd);
  win.on('session-end', onSessionEnd);

  win.on('close', () => {
    rememberBounds(note, win);
    if (!quitting && !note.deleted) {
      note.open = false;
      if (isEmptyNote(note)) {
        removeNote(note.id); // 빈 메모는 닫을 때 정리
      } else {
        maybeShowTrayHint();
      }
    }
    saveStateNow();
    refreshTrayMenu();
  });

  win.on('closed', () => {
    windows.delete(note.id);
    // 늦게 도착하는 저장 메시지를 처리할 수 있도록 잠시 뒤에 매핑 제거
    setTimeout(() => senderToNote.delete(contentsId), 5000);
    if (!quitting && windows.size === 0 && !tray) app.quit();
  });

  scheduleSave();
  refreshTrayMenu();
  return win;
}

// 기준 창에서 비켜 난 자리 (다른 메모와 정확히 겹치지 않는 곳) 찾기
function findFreeSpot(anchor, width, height) {
  const a = screen.getDisplayMatching({ ...anchor, width: anchor.width || width, height: anchor.height || height }).workArea;
  const taken = (x, y) => [...windows.values()].some((w) => {
    if (w.isDestroyed()) return false;
    const b = w.getBounds();
    return Math.abs(b.x - x) < 8 && Math.abs(b.y - y) < 8;
  });
  let x = anchor.x;
  let y = anchor.y;
  for (let i = 0; i < 40; i++) {
    x += CASCADE;
    y += CASCADE;
    if (x + width > a.x + a.width) x = a.x + 20;
    if (y + height > a.y + a.height) y = a.y + 20;
    if (!taken(x, y)) break;
  }
  return { x, y, width, height };
}

function createNote(source) {
  const width = source ? source.bounds.width : DEFAULT_BOUNDS.width;
  const height = source ? source.bounds.height : DEFAULT_BOUNDS.height;
  const srcWin = source && windows.get(source.id);
  let anchor = null;
  if (srcWin && !srcWin.isDestroyed() && srcWin.isVisible()) anchor = srcWin.getBounds();
  else if (source && isNum(source.bounds.x)) anchor = source.bounds;

  const note = makeNote({
    bounds: anchor ? findFreeSpot(anchor, width, height) : { width, height },
    pinned: source ? source.pinned : true,
    settings: { ...(source ? source.settings : DEFAULT_SETTINGS) }, // 색·글자 크기 등은 만든 메모를 따라감
  });
  state.notes.push(note);
  openNoteWindow(note);
  return note;
}

const lastFocusedNote = () => noteById(lastFocusedId) || state.notes.filter((n) => n.open).pop() || null;

function mostRecentNote() {
  return state.notes.reduce((best, n) => (!best || n.updatedAt > best.updatedAt ? n : best), null);
}

// 열려 있는 메모(✕ 로 닫지 않은 메모)를 모두 보이기. 하나도 없으면 최근 메모나 새 메모를 연다
function showOpenNotes() {
  const open = state.notes.filter((n) => n.open);
  if (open.length === 0) {
    const recent = mostRecentNote();
    if (recent) openNoteWindow(recent);
    else createNote(null);
    return;
  }
  const focusTarget = lastFocusedNote() && lastFocusedNote().open ? lastFocusedNote() : open[open.length - 1];
  open.forEach((n) => {
    if (n !== focusTarget) openNoteWindow(n, { focus: false });
  });
  openNoteWindow(focusTarget);
}

function openAllNotes() {
  state.notes.forEach((n) => openNoteWindow(n, { focus: false }));
  const target = lastFocusedNote();
  if (target) openNoteWindow(target);
}

// ---------------------------------------------------------------------------
// 트레이 (작업 표시줄 오른쪽 알림 영역): 새 메모 / 메모 목록 / 종료
// ---------------------------------------------------------------------------
function trayLabel(note) {
  const t = (note.title || '').trim() || '(빈 메모)';
  const short = t.length > 32 ? t.slice(0, 32) + '…' : t;
  return short.replace(/&/g, '&&'); // Windows 메뉴에서 & 는 단축키 표시로 해석됨
}

// 메모 목록 메뉴 항목 (● 열림 / ○ 닫힘, 누르면 그 메모를 열고 앞으로)
function noteListItems(currentId) {
  const items = state.notes.map((n) => ({
    label: (n.open ? '● ' : '○ ') + trayLabel(n) + (n.id === currentId ? '  (이 메모)' : ''),
    click: () => openNoteWindow(n),
  }));
  return items.length ? items : [{ label: '메모 없음', enabled: false }];
}

const QUIT_LABEL = '앱 종료';

// 메모 삭제 (확인 창: 메모 삭제 / 삭제 안 하고 돌아가기). 빈 메모는 묻지 않고 삭제
async function deleteNoteWithConfirm(note, parentWin) {
  if (!noteById(note.id)) return false;
  if (!isEmptyNote(note)) {
    const parent = parentWin && !parentWin.isDestroyed() ? parentWin : undefined;
    const name = (note.title || '').trim() || '(빈 메모)';
    const opts = {
      type: 'warning',
      buttons: ['메모 삭제', '삭제 안 하고 돌아가기'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'FloatMemo',
      message: `"${name.length > 40 ? name.slice(0, 40) + '…' : name}" 메모를 삭제할까요?`,
      detail: '삭제한 메모는 되돌릴 수 없습니다.',
    };
    const { response } = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
    if (response !== 0) return false;
  }
  note.deleted = true;
  const win = windows.get(note.id);
  removeNote(note.id);
  if (win && !win.isDestroyed()) win.close();
  return true;
}

// 확인 창이 항상 위에 떠 있는 메모들 뒤로 숨지 않도록, 보이는 메모 창을 부모로 쓴다
function dialogParent(preferred) {
  if (preferred && !preferred.isDestroyed()) return preferred;
  const last = lastFocusedNote() && windows.get(lastFocusedNote().id);
  if (last && !last.isDestroyed() && last.isVisible()) return last;
  return [...windows.values()].find((w) => !w.isDestroyed() && w.isVisible());
}

// '메모 삭제' 하위 메뉴: 열린 메모(●)도 닫힌 메모(○)도 바로 삭제 가능
function deleteMenuItem(parentWin) {
  const items = state.notes.map((n) => ({
    label: (n.open ? '● ' : '○ ') + trayLabel(n),
    click: () => deleteNoteWithConfirm(n, dialogParent(parentWin)),
  }));
  return { label: '메모 삭제', enabled: items.length > 0, submenu: items.length ? items : [{ label: '메모 없음', enabled: false }] };
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '새 메모', click: () => createNote(lastFocusedNote()) },
    { type: 'separator' },
    ...noteListItems(null),
    { type: 'separator' },
    { label: '모든 메모 열기', enabled: state.notes.length > 0, click: openAllNotes },
    deleteMenuItem(null),
    { type: 'separator' },
    { label: '빠른 색상 편집…', click: () => openOptionsWindow('colors') },
    { label: '단축키 도움말', click: () => openOptionsWindow('help') },
    { type: 'separator' },
    { label: QUIT_LABEL, click: () => app.quit() },
  ]);
}

// 메모 제목줄의 ⋯ 버튼 메뉴
function buildMoreMenu(note, win) {
  const quickItems = state.quickColors.map((q, i) => ({
    label: `${q.name}   (${q.type === 'bg' ? '배경' : '글자'} ${q.color})`,
    accelerator: `CommandOrControl+${i + 1}`,
    registerAccelerator: false, // 표시만 하고, 실제 단축키는 메모 편집 영역에서 처리
    click: () => { if (!win.isDestroyed()) win.webContents.send('memo:apply-quick-color', i); },
  }));
  return Menu.buildFromTemplate([
    { label: '새 메모', accelerator: 'CommandOrControl+N', registerAccelerator: false, click: () => createNote(note) },
    { label: '메모 목록', submenu: [
      ...noteListItems(note.id),
      { type: 'separator' },
      { label: '모든 메모 열기', enabled: state.notes.length > 0, click: openAllNotes },
      deleteMenuItem(win),
    ] },
    { type: 'separator' },
    { label: '빠른 색상', submenu: [
      ...(quickItems.length ? quickItems : [{ label: '지정된 빠른 색상 없음', enabled: false }]),
      { type: 'separator' },
      { label: '빠른 색상 편집…', click: () => openOptionsWindow('colors') },
    ] },
    { label: '단축키 도움말', click: () => openOptionsWindow('help') },
    { type: 'separator' },
    { label: QUIT_LABEL, click: () => app.quit() },
  ]);
}

// ---------------------------------------------------------------------------
// 설정 창 (빠른 색상 편집 / 단축키 도움말) - 하나만 띄움
// ---------------------------------------------------------------------------
let optionsWin = null;

function openOptionsWindow(tab) {
  if (optionsWin && !optionsWin.isDestroyed()) {
    optionsWin.webContents.send('memo:options-tab', tab);
    if (optionsWin.isMinimized()) optionsWin.restore();
    optionsWin.show();
    optionsWin.focus();
    return optionsWin;
  }
  optionsWin = new BrowserWindow({
    width: 560,
    height: 620,
    minWidth: 400,
    minHeight: 400,
    title: 'FloatMemo 설정',
    alwaysOnTop: true, // 항상 위에 떠 있는 메모들에 가려지지 않도록
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  optionsWin.loadFile(path.join(__dirname, 'options.html'), { query: { tab: tab === 'help' ? 'help' : 'colors' } });
  optionsWin.once('ready-to-show', () => optionsWin.show());
  optionsWin.on('closed', () => { optionsWin = null; });
  return optionsWin;
}

function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  });
}

let trayTimer = null;
function refreshTrayMenu() {
  if (!tray) return;
  clearTimeout(trayTimer);
  trayTimer = setTimeout(() => {
    if (tray && !tray.isDestroyed()) tray.setContextMenu(buildTrayMenu());
  }, 150);
}

function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
    tray = new Tray(icon);
    tray.setToolTip('FloatMemo');
    tray.on('click', showOpenNotes);
    tray.setContextMenu(buildTrayMenu());
  } catch (err) {
    console.error('트레이 아이콘 생성 실패:', err);
    tray = null;
  }
}

function maybeShowTrayHint() {
  if (state.trayHintShown || !tray || process.platform !== 'win32') return;
  state.trayHintShown = true;
  try {
    tray.displayBalloon({
      iconType: 'info',
      title: 'FloatMemo',
      content: '닫은 메모는 작업 표시줄 오른쪽 알림 영역의 FloatMemo 아이콘에서 다시 열 수 있습니다.',
    });
  } catch {
    /* 알림 실패는 무시 */
  }
}

// ---------------------------------------------------------------------------
// IPC (보낸 창으로 어느 메모인지 판별)
// ---------------------------------------------------------------------------
function ctxFor(e) {
  const note = noteById(senderToNote.get(e.sender.id));
  if (!note) return null;
  const win = windows.get(note.id);
  return { note, win: win && !win.isDestroyed() ? win : null };
}

ipcMain.handle('memo:get-state', (e) => {
  const c = ctxFor(e);
  if (!c) return null;
  return {
    content: c.note.content,
    pinned: c.note.pinned,
    collapsed: c.note.collapsed,
    settings: c.note.settings,
    defaults: DEFAULT_SETTINGS,
    quickColors: state.quickColors,
    platform: process.platform,
  };
});

ipcMain.handle('memo:get-quick-colors', () => ({
  list: state.quickColors,
  defaults: DEFAULT_QUICK_COLORS,
  max: MAX_QUICK_COLORS,
}));

ipcMain.on('memo:set-quick-colors', (_e, list) => {
  state.quickColors = sanitizeQuickColors(list);
  scheduleSave();
  refreshTrayMenu();
  broadcast('memo:quick-colors', state.quickColors);
});

ipcMain.on('memo:show-more-menu', (e, pos) => {
  const c = ctxFor(e);
  if (!c || !c.win) return;
  const x = Number(pos && pos.x);
  const y = Number(pos && pos.y);
  const opts = { window: c.win };
  if (Number.isFinite(x) && Number.isFinite(y)) Object.assign(opts, { x: Math.round(x), y: Math.round(y) });
  buildMoreMenu(c.note, c.win).popup(opts);
});

ipcMain.on('memo:open-options', (_e, tab) => openOptionsWindow(tab));

ipcMain.on('memo:save-content', (e, html, title) => {
  const c = ctxFor(e);
  if (!c || typeof html !== 'string') return;
  if (c.note.content === html) return;
  c.note.content = html;
  c.note.title = typeof title === 'string' ? title.slice(0, 60) : titleFromHtml(html);
  c.note.updatedAt = Date.now();
  scheduleSave();
  refreshTrayMenu();
});

ipcMain.on('memo:set-settings', (e, partial) => {
  const c = ctxFor(e);
  if (!c) return;
  c.note.settings = sanitizeSettings(c.note.settings, partial);
  scheduleSave();
});

ipcMain.on('memo:set-pinned', (e, flag) => {
  const c = ctxFor(e);
  if (!c) return;
  c.note.pinned = Boolean(flag);
  if (c.win) applyAlwaysOnTop(c.win, c.note.pinned);
  scheduleSave();
});

ipcMain.on('memo:set-collapsed', (e, flag) => {
  const c = ctxFor(e);
  if (c) setCollapsed(c.note, c.win, flag);
});

ipcMain.on('memo:new-note', (e) => {
  const c = ctxFor(e);
  createNote(c ? c.note : lastFocusedNote());
});

ipcMain.handle('memo:delete-note', async (e) => {
  const c = ctxFor(e);
  return c ? deleteNoteWithConfirm(c.note, c.win) : false;
});

// 투명 창은 OS 기본 테두리 리사이즈가 불안정하므로 렌더러의 리사이즈 핸들에서 직접 크기를 조정
ipcMain.handle('memo:get-bounds', (e) => {
  const c = ctxFor(e);
  return c && c.win ? c.win.getBounds() : null;
});
ipcMain.on('memo:set-bounds', (e, b) => {
  const c = ctxFor(e);
  if (!c || !c.win || !b) return;
  const next = {
    x: Math.round(Number(b.x)),
    y: Math.round(Number(b.y)),
    width: Math.max(MIN_WIDTH, Math.round(Number(b.width))),
    height: c.note.collapsed ? COLLAPSED_HEIGHT : Math.max(MIN_HEIGHT, Math.round(Number(b.height))),
  };
  if (Object.values(next).some((v) => !Number.isFinite(v))) return;
  c.win.setBounds(next);
});

ipcMain.on('memo:minimize', (e) => {
  const c = ctxFor(e);
  if (c && c.win) c.win.minimize();
});
ipcMain.on('memo:close', (e) => {
  const c = ctxFor(e);
  if (c && c.win) c.win.close();
});

// ---------------------------------------------------------------------------
// 앱 생명주기
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // 이미 실행 중일 때 exe 를 다시 실행하면 메모들을 앞으로 가져옴
  app.on('second-instance', () => showOpenNotes());

  app.whenReady().then(() => {
    // 기본 앱 메뉴의 단축키(Ctrl+R 새로고침, Ctrl+0/+/- 확대 등)가 메모 단축키와 겹치지 않도록 제거
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
    state = loadState();
    createTray();
    showOpenNotes();

    // 전역 단축키: 다른 앱을 쓰는 중에도 메모들을 앞으로 불러오기 / 숨기기
    globalShortcut.register('CommandOrControl+Shift+M', () => {
      const live = [...windows.values()].filter((w) => !w.isDestroyed());
      if (live.some((w) => w.isFocused())) live.forEach((w) => w.hide());
      else showOpenNotes();
    });

    app.on('activate', () => showOpenNotes());
  });

  // 트레이가 있으면 메모를 모두 닫아도 계속 실행 (트레이에서 다시 열기 / 종료)
  app.on('window-all-closed', () => {
    if (!tray) app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    saveStateNow();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    saveStateNow();
  });
}
