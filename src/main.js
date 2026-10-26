'use strict';

const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// 영구 저장 (메모 내용 / 창 위치·크기 / 표시 설정 / 고정 여부)
// ---------------------------------------------------------------------------
const STATE_FILE = () => path.join(app.getPath('userData'), 'state.json');

const MIN_WIDTH = 220;
const MIN_HEIGHT = 160;
const COLLAPSED_HEIGHT = 36; // 제목줄(34px) + 테두리

const DEFAULT_SETTINGS = {
  bgOpacity: 0.92, // 0(완전 투명) ~ 1(불투명) - 메모지 배경에만 적용, 글자는 항상 선명
  fontSize: 14, // px
  textColor: '#2b2b2b',
  paperColor: '#fff8c6',
};

const DEFAULT_STATE = {
  bounds: { width: 360, height: 420 },
  pinned: true,
  collapsed: false, // 내용 접기: 제목줄만 남긴 상태 (state.bounds 에는 펼친 크기를 보관)
  content: '',
  settings: { ...DEFAULT_SETTINGS },
};

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
    const state = { ...DEFAULT_STATE, ...raw, settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) } };
    // 1.0 버전 호환: 창 전체 투명도 값을 배경 투명도로 옮김
    if (typeof raw.opacity === 'number' && !raw.settings) state.settings.bgOpacity = raw.opacity;
    delete state.opacity;
    return state;
  } catch {
    return { ...DEFAULT_STATE, settings: { ...DEFAULT_SETTINGS } };
  }
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
  try {
    fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true });
    fs.writeFileSync(STATE_FILE(), JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('상태 저장 실패:', err);
  }
}

// 저장된 창 위치가 현재 연결된 모니터 안에 있는지 확인 (모니터 구성이 바뀐 경우 대비)
function clampBounds(bounds) {
  const { width, height } = bounds;
  if (typeof bounds.x !== 'number' || typeof bounds.y !== 'number') {
    return { width, height };
  }
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return (
      bounds.x + width > a.x + 40 &&
      bounds.x < a.x + a.width - 40 &&
      bounds.y + height > a.y + 40 &&
      bounds.y < a.y + a.height - 40
    );
  });
  return visible ? bounds : { width, height };
}

const isHexColor = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

function sanitizeSettings(input) {
  const s = { ...state.settings };
  if (input && typeof input === 'object') {
    if (typeof input.bgOpacity === 'number' && Number.isFinite(input.bgOpacity)) {
      s.bgOpacity = Math.min(1, Math.max(0, input.bgOpacity));
    }
    if (typeof input.fontSize === 'number' && Number.isFinite(input.fontSize)) {
      s.fontSize = Math.min(48, Math.max(8, Math.round(input.fontSize)));
    }
    if (isHexColor(input.textColor)) s.textColor = input.textColor;
    if (isHexColor(input.paperColor)) s.paperColor = input.paperColor;
  }
  return s;
}

// ---------------------------------------------------------------------------
// 창 생성
// ---------------------------------------------------------------------------
let win = null;

function applyAlwaysOnTop(flag) {
  if (!win) return;
  // 'screen-saver' 레벨은 macOS에서 가장 높은 레벨, Windows/Linux에서는 일반 topmost 로 동작
  win.setAlwaysOnTop(flag, 'screen-saver');
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(flag, { visibleOnFullScreen: true });
  }
}

// 현재 창 크기를 state.bounds 에 기록. 접힌 상태에서는 높이를 건드리지 않아 펼칠 때 원래 높이로 돌아감
function rememberBounds() {
  if (!win || win.isMinimized()) return;
  const b = win.getBounds();
  state.bounds = state.collapsed ? { ...b, height: state.bounds.height } : b;
}

function setCollapsed(flag) {
  if (!win) return;
  flag = Boolean(flag);
  if (flag === state.collapsed) return;
  rememberBounds();
  state.collapsed = flag;
  const b = win.getBounds();
  if (flag) {
    win.setMinimumSize(MIN_WIDTH, COLLAPSED_HEIGHT);
    win.setBounds({ ...b, height: COLLAPSED_HEIGHT });
  } else {
    // 최소 크기를 먼저 바꾸면 그때 발생하는 resize 이벤트가 저장된 높이를 덮어쓰므로, 높이를 먼저 복원
    const height = Math.max(MIN_HEIGHT, state.bounds.height || DEFAULT_STATE.bounds.height);
    win.setBounds({ ...b, height });
    win.setMinimumSize(MIN_WIDTH, MIN_HEIGHT);
  }
  scheduleSave();
}

function createWindow() {
  state = loadState();
  const bounds = { ...clampBounds(state.bounds) }; // 복사본: state.bounds(펼친 크기)를 건드리지 않도록
  if (state.collapsed) bounds.height = COLLAPSED_HEIGHT;

  win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: state.collapsed ? COLLAPSED_HEIGHT : MIN_HEIGHT,
    maximizable: false, // 제목줄 더블클릭 / 화면 위로 끌기 시 최대화되지 않도록
    frame: false,
    transparent: true, // 배경 투명도 0까지 지원 (글자는 그대로 보임)
    hasShadow: false,
    show: false,
    alwaysOnTop: state.pinned,
    skipTaskbar: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.once('ready-to-show', () => {
    applyAlwaysOnTop(state.pinned);
    win.show();
  });

  const onBoundsChanged = () => {
    rememberBounds();
    scheduleSave();
  };
  win.on('resize', onBoundsChanged);
  win.on('move', onBoundsChanged);

  win.on('close', () => {
    // 한 번도 움직이지 않은 창도 마지막 위치를 기억
    rememberBounds();
    saveStateNow();
  });

  win.on('closed', () => {
    win = null;
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.handle('memo:get-state', () => ({
  content: state.content,
  pinned: state.pinned,
  collapsed: state.collapsed,
  settings: state.settings,
  defaults: DEFAULT_SETTINGS,
  platform: process.platform,
}));

ipcMain.on('memo:save-content', (_e, html) => {
  if (typeof html !== 'string') return;
  state.content = html;
  scheduleSave();
});

ipcMain.on('memo:set-settings', (_e, partial) => {
  state.settings = sanitizeSettings(partial);
  scheduleSave();
});

ipcMain.on('memo:set-pinned', (_e, flag) => {
  state.pinned = Boolean(flag);
  applyAlwaysOnTop(state.pinned);
  scheduleSave();
});

ipcMain.on('memo:set-collapsed', (_e, flag) => setCollapsed(flag));

// 투명 창은 OS 기본 테두리 리사이즈가 불안정하므로 렌더러의 리사이즈 핸들에서 직접 크기를 조정
ipcMain.handle('memo:get-bounds', () => (win ? win.getBounds() : null));
ipcMain.on('memo:set-bounds', (_e, b) => {
  if (!win || !b) return;
  const next = {
    x: Math.round(Number(b.x)),
    y: Math.round(Number(b.y)),
    width: Math.max(MIN_WIDTH, Math.round(Number(b.width))),
    height: state.collapsed ? COLLAPSED_HEIGHT : Math.max(MIN_HEIGHT, Math.round(Number(b.height))),
  };
  if (Object.values(next).some((v) => !Number.isFinite(v))) return;
  win.setBounds(next);
});

ipcMain.on('memo:minimize', () => win && win.minimize());
ipcMain.on('memo:close', () => win && win.close());

// ---------------------------------------------------------------------------
// 앱 생명주기
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();

    // 전역 단축키: 다른 앱을 쓰는 중에도 메모장을 앞으로 불러오기 / 숨기기
    globalShortcut.register('CommandOrControl+Shift+M', () => {
      if (!win) return createWindow();
      if (win.isVisible() && win.isFocused()) {
        win.hide();
      } else {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else if (win) win.show();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    globalShortcut.unregisterAll();
    if (state) saveStateNow();
  });
}
