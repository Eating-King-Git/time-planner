'use strict';
// IPC 与持久化数据的校验/清洗。不信任任何外部输入。

const MAX_TEXT = 500;
const IMPACTS = new Set(['low', 'medium', 'high']);
const STATUSES = new Set(['todo', 'done', 'postponed']);
const HORIZONS = new Set(['today', 'long']);

const str = (v, max = MAX_TEXT) => {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s || null;
};
const num = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const dateOrNull = (v) => {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const enumOr = (v, set) => (v == null ? null : set.has(v) ? v : null);

function isValidId(id) {
  return typeof id === 'string' && /^[\w-]{1,64}$/.test(id);
}

// 由文本解析结果 + 结构化字段合成一个待保存任务
function sanitizeTaskDraft(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = str(raw.title);
  if (!title) return null;
  const draft = {
    title,
    text: str(raw.text) || title,
    deadline: dateOrNull(raw.deadline),
    fixedStart: dateOrNull(raw.fixedStart),
    fixedEnd: dateOrNull(raw.fixedEnd),
    durationMinutes: num(raw.durationMinutes, 5, 480),
    impact: enumOr(raw.impact, IMPACTS),
    horizon: enumOr(raw.horizon, HORIZONS) || 'today',
    location: str(raw.location, 120),
    source: str(raw.source, 120),
    autoSchedule: raw.autoSchedule !== false,
    importantOverride: raw.importantOverride == null ? null : !!bool(raw.importantOverride),
    urgentOverride: raw.urgentOverride == null ? null : !!bool(raw.urgentOverride),
    locked: !!bool(raw.locked),
  };
  if (draft.importantOverride === undefined) draft.importantOverride = null;
  if (draft.urgentOverride === undefined) draft.urgentOverride = null;
  return draft;
}

// 持久化任务：读盘时逐条校验，坏的丢弃
function validateTask(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isValidId(raw.id)) return null;
  const title = str(raw.title);
  if (!title) return null;
  const status = STATUSES.has(raw.status) ? raw.status : 'todo';
  const t = {
    id: raw.id,
    title,
    text: str(raw.text) || title,
    status,
    createdAt: dateOrNull(raw.createdAt) || new Date().toISOString(),
    updatedAt: dateOrNull(raw.updatedAt) || new Date().toISOString(),
    doneAt: status === 'done' ? (dateOrNull(raw.doneAt) || dateOrNull(raw.completedAt) || dateOrNull(raw.updatedAt)) : null,
    carryOverFrom: dateOrNull(raw.carryOverFrom),
    lastPlannedAt: dateOrNull(raw.lastPlannedAt),
    deadline: dateOrNull(raw.deadline),
    fixedStart: dateOrNull(raw.fixedStart),
    fixedEnd: dateOrNull(raw.fixedEnd),
    durationMinutes: num(raw.durationMinutes, 5, 480),
    impact: enumOr(raw.impact, IMPACTS),
    horizon: enumOr(raw.horizon, HORIZONS) || 'today',
    location: str(raw.location, 120),
    source: str(raw.source, 120),
    autoSchedule: raw.autoSchedule !== false,
    vague: !!bool(raw.vague),
    important: !!bool(raw.important),
    urgent: !!bool(raw.urgent),
    importance: num(raw.importance, 0, 100) || 0,
    urgency: num(raw.urgency, 0, 100) || 0,
    quadrant: ['q1', 'q2', 'q3', 'q4'].includes(raw.quadrant) ? raw.quadrant : 'q4',
    explanation: str(raw.explanation) || '',
    confidence: num(raw.confidence, 0, 1) ?? 0.5,
    importantOverride: raw.importantOverride == null ? null : !!raw.importantOverride,
    urgentOverride: raw.urgentOverride == null ? null : !!raw.urgentOverride,
    locked: !!bool(raw.locked),
    wasScheduled: !!bool(raw.wasScheduled),
    block: raw.block && dateOrNull(raw.block.start) && dateOrNull(raw.block.end)
      ? { start: dateOrNull(raw.block.start), end: dateOrNull(raw.block.end) }
      : null,
  };
  return t;
}

function validateSettings(raw) {
  const d = {
    alwaysOnTop: true,
    compact: true,
    quietStart: '22:00',
    quietEnd: '08:00',
    zoomFactor: 1,
    compactBounds: null,
    fullBounds: null,
  };
  if (!raw || typeof raw !== 'object') return d;
  const s = { ...d };
  if (typeof raw.alwaysOnTop === 'boolean') s.alwaysOnTop = raw.alwaysOnTop;
  if (typeof raw.compact === 'boolean') s.compact = raw.compact;
  for (const k of ['quietStart', 'quietEnd']) {
    if (typeof raw[k] === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw[k])) s[k] = raw[k];
  }
  const zoom = num(raw.zoomFactor, 0.75, 1.3);
  if (zoom != null) s.zoomFactor = Math.round(zoom * 20) / 20;
  for (const k of ['compactBounds', 'fullBounds']) {
    if (raw[k] && typeof raw[k] === 'object') s[k] = validateBounds(raw[k]);
  }
  return s;
}

function validateBounds(raw) {
  const d = { width: 360, height: 480, x: undefined, y: undefined };
  if (!raw || typeof raw !== 'object') return d;
  const b = { ...d };
  for (const k of ['width', 'height', 'x', 'y']) {
    const n = Number(raw[k]);
    if (Number.isFinite(n) && n > 0 && n < 100000) b[k] = Math.round(n);
    else if (k === 'x' || k === 'y') b[k] = undefined;
  }
  b.width = Math.max(280, Math.min(1200, b.width));
  b.height = Math.max(360, Math.min(900, b.height));
  return b;
}

module.exports = { sanitizeTaskDraft, validateTask, validateSettings, validateBounds, isValidId };
