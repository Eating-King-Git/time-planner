'use strict';
// 主进程：窗口管理、IPC（含载荷校验）、JSON 持久化、当日排程与提醒。
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { JsonStore } = require('./store');
const { ReminderManager } = require('./reminders');
const { planDay } = require('./core/schedule');
const { classify } = require('./core/classify');
const { applyCarryOver } = require('./core/carryover');
const { sanitizeTaskDraft, validateTask, validateSettings, validateBounds, isValidId } = require('./core/validate');

const COMPACT_SIZE = { width: 420, height: 510 };
const FULL_SIZE = { width: 680, height: 720 };
const COMPACT_MIN = { width: 300, height: 360 };
const FULL_MIN = { width: 440, height: 480 };

let win = null;
let tasksStore;      // 任务数组
let settingsStore;   // 设置（含窗口偏好）
let reminders;       // ReminderManager
let saveBoundsTimer = null;

const settings = () => validateSettings(settingsStore.data);
const bounds = () => validateBounds(settingsStore.data.bounds);

function modeBounds(s = settings()) {
  const saved = s.compact ? s.compactBounds : s.fullBounds;
  if (saved) return validateBounds(saved);
  if (!s.compactBounds && !s.fullBounds && settingsStore.data && settingsStore.data.bounds) return bounds();
  const size = s.compact ? COMPACT_SIZE : FULL_SIZE;
  return { ...size, x: undefined, y: undefined };
}

function loadStores() {
  const dir = app.getPath('userData');
  tasksStore = new JsonStore(path.join(dir, 'tasks.json'), []);
  settingsStore = new JsonStore(path.join(dir, 'settings.json'), validateSettings(null));
  const reminderStore = new JsonStore(path.join(dir, 'reminders.json'), []);
  tasksStore.update((list) => (Array.isArray(list) ? list : []).map(validateTask).filter(Boolean));
  settingsStore.update((raw) => {
    const validated = validateSettings(raw);
    const legacy = raw && raw.bounds ? validateBounds(raw.bounds) : null;
    if (legacy && !validated.compactBounds && !validated.fullBounds) {
      if (validated.compact) validated.compactBounds = legacy;
      else validated.fullBounds = legacy;
    }
    return { ...validated, bounds: legacy || validateBounds(null) };
  });
  reminders = new ReminderManager(reminderStore, settings, () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

function replanToday() {
  const now = new Date();
  tasksStore.update((tasks) => applyCarryOver(tasks, now));
  const plan = planDay({ tasks: tasksStore.data, date: now, now, settings: {} });
  const firstBlock = new Map();
  for (const b of plan.blocks) {
    if ((b.kind === 'task' || b.kind === 'locked') && !firstBlock.has(b.taskId)) firstBlock.set(b.taskId, b);
  }
  tasksStore.update((tasks) => tasks.map((t) => {
    const b = firstBlock.get(t.id);
    return {
      ...t,
      block: b ? { start: b.start.toISOString(), end: b.end.toISOString() } : (t.locked ? t.block : null),
      lastPlannedAt: b ? b.start.toISOString() : t.lastPlannedAt,
      wasScheduled: t.wasScheduled || !!b,
    };
  }));
  reminders.rebuild(plan.blocks, tasksStore.data);
  return serializePlan(plan);
}

function serializePlan(plan) {
  return {
    ...plan,
    blocks: plan.blocks.map((b) => ({ ...b, start: b.start.toISOString(), end: b.end.toISOString() })),
  };
}

function broadcast() {
  if (win && !win.isDestroyed()) {
    const plan = replanToday();
    win.webContents.send('data:changed', { tasks: tasksStore.data, plan, settings: settings() });
  }
}

function buildTask(draft, existing) {
  const base = existing || {
    id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'todo',
    createdAt: new Date().toISOString(),
    doneAt: null,
    carryOverFrom: null,
    lastPlannedAt: null,
    wasScheduled: false,
    block: null,
    locked: false,
  };
  const merged = { ...base, ...draft, updatedAt: new Date().toISOString() };
  const scored = classify(merged, new Date());
  return { ...merged, ...scored };
}

function registerIpc() {
  ipcMain.handle('data:load', () => {
    const plan = replanToday();
    return { tasks: tasksStore.data, plan, settings: settings() };
  });

  ipcMain.handle('task:save', (_e, draft) => {
    const clean = sanitizeTaskDraft(draft);
    if (!clean) return { error: '任务内容无效' };
    const existing = draft.id && isValidId(draft.id) ? tasksStore.data.find((t) => t.id === draft.id) : null;
    // 编辑时保留调度状态，避免渲染端草稿意外解锁/丢块
    const preserved = existing ? {
      locked: existing.locked, block: existing.block, wasScheduled: existing.wasScheduled,
      location: clean.location || existing.location, source: clean.source || existing.source,
    } : {};
    const task = buildTask({ ...clean, ...preserved }, existing || undefined);
    tasksStore.update((tasks) => (existing ? tasks.map((t) => (t.id === task.id ? task : t)) : [...tasks, task]));
    broadcast();
    return { task };
  });

  ipcMain.handle('task:update', (_e, id, patch) => {
    if (!isValidId(id) || !patch || typeof patch !== 'object') return { error: '参数无效' };
    const existing = tasksStore.data.find((t) => t.id === id);
    if (!existing) return { error: '任务不存在' };
    const allowed = sanitizeTaskDraft({ ...existing, ...patch, title: patch.title ?? existing.title });
    if (!allowed) return { error: '更新内容无效' };
    const status = ['todo', 'done', 'postponed'].includes(patch.status) ? patch.status : existing.status;
    const block = patch.block === null ? null : existing.block;
    const task = buildTask({ ...allowed, status, doneAt: status === 'done' ? new Date().toISOString() : null, block }, existing);
    tasksStore.update((tasks) => tasks.map((t) => (t.id === id ? task : t)));
    broadcast();
    return { task };
  });

  ipcMain.handle('task:delete', (_e, id) => {
    if (!isValidId(id)) return { error: '参数无效' };
    const removed = tasksStore.data.find((t) => t.id === id);
    if (!removed) return { error: '任务不存在' };
    tasksStore.update((tasks) => tasks.filter((t) => t.id !== id));
    broadcast();
    return { removed };
  });

  ipcMain.handle('task:restore', (_e, raw) => {
    const task = validateTask(raw);
    if (!task) return { error: '任务数据无效' };
    tasksStore.update((tasks) => (tasks.some((t) => t.id === task.id) ? tasks : [...tasks, task]));
    broadcast();
    return { task };
  });

  ipcMain.handle('plan:today', () => {
    const plan = replanToday();
    if (win && !win.isDestroyed()) {
      win.webContents.send('data:changed', { tasks: tasksStore.data, plan, settings: settings() });
    }
    return plan;
  });

  ipcMain.handle('settings:set', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return { error: '参数无效' };
    settingsStore.update((s) => ({ ...validateSettings({ ...s, ...patch }), bounds: bounds() }));
    applyWindowPrefs();
    broadcast();
    return { settings: settings() };
  });

  ipcMain.on('win:minimize', () => win && win.minimize());
  ipcMain.on('win:quit', () => app.quit());
  ipcMain.handle('win:togglePin', () => {
    const next = !settings().alwaysOnTop;
    settingsStore.update((s) => ({ ...s, alwaysOnTop: next }));
    applyWindowPrefs();
    return { alwaysOnTop: next };
  });
  ipcMain.handle('win:setMode', (_e, compact) => {
    if (typeof compact !== 'boolean') return { error: '参数无效' };
    clearTimeout(saveBoundsTimer);
    settingsStore.update((s) => {
      if (!win || win.isDestroyed() || win.isMinimized()) return { ...s, compact };
      const [width, height] = win.getSize();
      const [x, y] = win.getPosition();
      const currentBounds = validateBounds({ width, height, x, y });
      const currentModeKey = s.compact ? 'compactBounds' : 'fullBounds';
      return { ...s, [currentModeKey]: currentBounds, bounds: currentBounds, compact };
    });
    applyWindowPrefs();
    restoreModeBounds();
    return { compact };
  });
  ipcMain.handle('win:setZoom', (_e, rawZoom) => {
    const n = Number(rawZoom);
    if (!Number.isFinite(n)) return { error: '缩放参数无效' };
    const zoomFactor = Math.round(Math.min(1.3, Math.max(0.75, n)) * 20) / 20;
    settingsStore.update((s) => ({ ...s, zoomFactor }));
    if (win && !win.isDestroyed()) win.webContents.setZoomFactor(zoomFactor);
    return { zoomFactor };
  });
}

function applyWindowPrefs() {
  if (!win || win.isDestroyed()) return;
  const s = settings();
  win.setAlwaysOnTop(s.alwaysOnTop, 'screen-saver');
  const min = s.compact ? COMPACT_MIN : FULL_MIN;
  win.setMinimumSize(min.width, min.height);
  win.setResizable(true);
  win.webContents.setZoomFactor(s.zoomFactor);
  win.webContents.send('mode:changed', { compact: s.compact, alwaysOnTop: s.alwaysOnTop });
}

function restoreModeBounds() {
  if (!win || win.isDestroyed()) return;
  const b = modeBounds();
  win.setSize(b.width, b.height);
  if (Number.isFinite(b.x) && Number.isFinite(b.y)) win.setPosition(b.x, b.y);
}

function persistBounds() {
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const [width, height] = win.getSize();
    const [x, y] = win.getPosition();
    settingsStore.update((s) => {
      const nextBounds = validateBounds({ width, height, x, y });
      const modeKey = s.compact ? 'compactBounds' : 'fullBounds';
      return { ...s, bounds: nextBounds, [modeKey]: nextBounds };
    });
  }, 500);
}

function createWindow() {
  const b = modeBounds();
  win = new BrowserWindow({
    ...b,
    minWidth: 280,
    minHeight: 320,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    show: false,
    backgroundColor: '#1e1f24',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(settings().alwaysOnTop, 'screen-saver');
  applyWindowPrefs();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(settings().zoomFactor));
  win.once('ready-to-show', () => win.show());
  win.on('resize', persistBounds);
  win.on('move', persistBounds);
}

app.whenReady().then(() => {
  loadStores();
  registerIpc();
  createWindow();
  reminders.start();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => reminders.stop());
app.on('window-all-closed', () => app.quit());
