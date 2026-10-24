'use strict';

const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// 영구 저장 (메모 내용 / 창 위치·크기 / 투명도 / 고정 여부)
// ---------------------------------------------------------------------------
const STATE_FILE = () => path.join(app.getPath('userData'), 'state.json');

const DEFAULT_STATE = {
  bounds: { width: 360, height: 420 },
  opacity: 0.92,
  pinned: true,
  content: '',
};

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE(), 'utf8');
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
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

function createWindow() {
  state = loadState();
  const bounds = clampBounds(state.bounds);

  win = new BrowserWindow({
    ...bounds,
    minWidth: 220,
    minHeight: 160,
    frame: false,
    show: false,
    alwaysOnTop: state.pinned,
    skipTaskbar: false,
    backgroundColor: '#fff8c6',
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
    win.setOpacity(state.opacity);
    applyAlwaysOnTop(state.pinned);
    win.show();
  });

  const rememberBounds = () => {
    if (!win || win.isMinimized()) return;
    state.bounds = win.getBounds();
    scheduleSave();
  };
  win.on('resize', rememberBounds);
  win.on('move', rememberBounds);

  win.on('close', () => {
    // 한 번도 움직이지 않은 창도 마지막 위치를 기억
    if (!win.isMinimized()) state.bounds = win.getBounds();
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
  opacity: state.opacity,
  pinned: state.pinned,
  platform: process.platform,
}));

ipcMain.on('memo:save-content', (_e, html) => {
  if (typeof html !== 'string') return;
  state.content = html;
  scheduleSave();
});

ipcMain.on('memo:set-opacity', (_e, value) => {
  const v = Math.min(1, Math.max(0.15, Number(value) || 1));
  state.opacity = v;
  if (win) win.setOpacity(v);
  scheduleSave();
});

ipcMain.on('memo:set-pinned', (_e, flag) => {
  state.pinned = Boolean(flag);
  applyAlwaysOnTop(state.pinned);
  scheduleSave();
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
