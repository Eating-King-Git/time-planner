'use strict';
// 确定性日程规划：工作时段、固定事件防重叠、优先级排序、缓冲、拆分、不可行截止检测。
// 纯函数：tasks 中带 ISO 字符串或 Date 均可，返回中带 Date 对象。

const DEFAULTS = {
  workStart: '09:00',
  workEnd: '18:00',
  lunchStart: '12:00',
  lunchEnd: '13:30',
  bufferRatio: 0.2,
  maxKeyOutcomes: 3,
  inflateRatio: 1.5,
  chunkMinutes: 90,
};

const toDate = (v) => (v == null ? null : v instanceof Date ? v : new Date(v));
const isoDay = (d) => d.toISOString().slice(0, 10);

function minutesOf(hhmm, base) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// 拆分为 <=chunk 的块；尾块 <20 分钟时并入前一块
function splitEstimate(minutes, chunk = DEFAULTS.chunkMinutes) {
  const blocks = [];
  let rest = Math.round(minutes);
  while (rest > chunk) { blocks.push(chunk); rest -= chunk; }
  if (rest > 0) {
    if (rest < 20 && blocks.length) blocks[blocks.length - 1] += rest;
    else blocks.push(rest);
  }
  return blocks;
}

function priorityRank(t) {
  if (t.important && t.urgent) return 1;
  if (t.important) return 2;
  if (t.urgent) return 3;
  return 4;
}

// tasks: 任务数组；date: 规划日(Date)；now: 当前时间(Date)
function planDay({ tasks, date, now = new Date(), settings = {} }) {
  const cfg = { ...DEFAULTS, ...settings };
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const workStart = minutesOf(cfg.workStart, day);
  const workEnd = minutesOf(cfg.workEnd, day);
  const dayEnd = new Date(day); dayEnd.setDate(dayEnd.getDate() + 1);
  const lunchStart = minutesOf(cfg.lunchStart, day);
  const lunchEnd = minutesOf(cfg.lunchEnd, day);
  const nowDate = toDate(now);
  const sameDayAsNow = day.getFullYear() === nowDate.getFullYear() &&
    day.getMonth() === nowDate.getMonth() && day.getDate() === nowDate.getDate();
  // 当天重排不能把新任务塞回已经过去的时间；向上取整到下一分钟。
  const autoStart = sameDayAsNow && nowDate > workStart
    ? new Date(Math.min(workEnd.getTime(), Math.ceil(nowDate.getTime() / 60000) * 60000))
    : workStart;

  const warnings = [];
  const blocks = [];
  const occupied = []; // {start,end,label}

  // 固定事件：不可变、不得重叠
  const fixed = (tasks || []).filter((t) =>
    t.status !== 'done' &&
    t.fixedStart && t.fixedEnd &&
    overlaps(toDate(t.fixedStart), toDate(t.fixedEnd), day, dayEnd));
  fixed.sort((a, b) => toDate(a.fixedStart) - toDate(b.fixedStart));
  for (const t of fixed) {
    const fs = toDate(t.fixedStart), fe = toDate(t.fixedEnd);
    const clash = occupied.find((o) => overlaps(fs, fe, o.start, o.end));
    if (clash) warnings.push({ type: 'fixed-overlap', taskId: t.id, message: `固定事件「${t.title}」与「${clash.label}」时间冲突` });
    occupied.push({ start: fs, end: fe, label: t.title, kind: 'fixed', task: t });
  }

  // 手动锁定的块：重排时保留
  const lockedTasks = (tasks || []).filter((t) =>
    t.locked && t.block && toDate(t.block.start) &&
    overlaps(toDate(t.block.start), toDate(t.block.end), workStart, workEnd));
  for (const t of lockedTasks) {
    const bs = toDate(t.block.start), be = toDate(t.block.end);
    const clash = occupied.find((o) => overlaps(bs, be, o.start, o.end));
    if (clash) warnings.push({ type: 'locked-overlap', taskId: t.id, message: `锁定块「${t.title}」与「${clash.label}」冲突` });
    else occupied.push({ start: bs, end: be, label: t.title, kind: 'locked', task: t });
  }

  // 空闲时段 = 工作时窗 - 午餐 - 已占用
  const free = computeFree(autoStart, workEnd, lunchStart, lunchEnd,
    occupied.filter((o) => overlaps(o.start, o.end, workStart, workEnd)));

  const workMinutes = (workEnd - workStart) / 60000 - (lunchEnd - lunchStart) / 60000;
  const taskCapacity = Math.floor(workMinutes * (1 - cfg.bufferRatio));

  // 可参与自动排程的任务：未完成、非“既不重要也不紧急”、无固定时间
  const eligible = (tasks || [])
    .filter((t) => ['todo', 'postponed'].includes(t.status))
    .filter((t) => t.autoSchedule !== false)
    .filter((t) => t.important || t.urgent)
    .filter((t) => !(t.fixedStart && t.fixedEnd) ||
      (t.carryOverFrom && !overlaps(toDate(t.fixedStart), toDate(t.fixedEnd), day, dayEnd)))
    .filter((t) => !(t.locked && t.block && toDate(t.block.start)) ||
      (t.carryOverFrom && !overlaps(toDate(t.block.start), toDate(t.block.end), day, dayEnd)))
    .sort((a, b) =>
      priorityRank(a) - priorityRank(b) ||
      (toDate(a.deadline)?.getTime() ?? Infinity) - (toDate(b.deadline)?.getTime() ?? Infinity) ||
      String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

  let usedTaskMinutes = 0;
  let keyCount = 0;
  const scheduledIds = new Set();
  const unscheduled = [];

  for (const t of eligible) {
    const ratio = t.wasScheduled ? 1 : cfg.inflateRatio;
    const estimate = Math.round((t.durationMinutes || 30) * ratio);
    const chunks = splitEstimate(estimate, cfg.chunkMinutes);
    // 先在空闲时段的副本中试排；只有整个任务都能放下才提交，
    // 避免多块任务只放下一部分时留下“幽灵占位”。
    const trialFree = free.map((g) => ({ start: new Date(g.start), end: new Date(g.end) }));
    let trialUsed = usedTaskMinutes;
    const placed = [];
    for (const size of chunks) {
      const gap = trialFree.find((g) => g.end - g.start >= size * 60000);
      const withinCap = trialUsed + size <= taskCapacity;
      if (!gap || !withinCap) break;
      const start = gap.start;
      const end = new Date(start.getTime() + size * 60000);
      gap.start = end;
      placed.push({ start, end });
      trialUsed += size;
    }
    if (placed.length === chunks.length) {
      for (let i = 0; i < free.length; i += 1) free[i].start = trialFree[i].start;
      usedTaskMinutes = trialUsed;
      scheduledIds.add(t.id);
      const isKey = keyCount < cfg.maxKeyOutcomes;
      if (isKey) keyCount += 1;
      for (const p of placed) {
        blocks.push({ taskId: t.id, title: t.title, start: p.start, end: p.end, kind: 'task', locked: !!t.locked, keyOutcome: isKey });
      }
    } else {
      unscheduled.push(t.id);
      warnings.push({ type: 'no-capacity', taskId: t.id, message: `「${t.title}」今日时间不足，未能排入（约需${estimate}分钟）` });
    }
  }

  // 固定与锁定块写入结果
  for (const o of occupied) {
    if (o.kind === 'fixed') blocks.push({ taskId: o.task.id, title: o.task.title, start: o.start, end: o.end, kind: 'fixed', locked: true, keyOutcome: false });
    else blocks.push({ taskId: o.task.id, title: o.task.title, start: o.start, end: o.end, kind: 'locked', locked: true, keyOutcome: false });
  }
  blocks.sort((a, b) => a.start - b.start);

  // 不可行截止检测
  for (const t of tasks || []) {
    if (!t.deadline || t.status === 'done') continue;
    const dl = toDate(t.deadline);
    const mine = blocks.filter((b) => b.taskId === t.id);
    if (mine.length && mine[mine.length - 1].end > dl) {
      warnings.push({ type: 'infeasible', taskId: t.id, message: `「${t.title}」最后一块（${fmt(mine[mine.length - 1].end)}）晚于截止（${fmt(dl)}），可能无法按时完成` });
    } else if (!mine.length && unscheduled.includes(t.id) && dl <= workEnd) {
      warnings.push({ type: 'infeasible', taskId: t.id, message: `「${t.title}」截止在即但今日排不进，存在逾期风险` });
    }
  }

  return { date: isoDay(day), blocks, warnings, unscheduled, capacityMinutes: taskCapacity, usedTaskMinutes };
}

function computeFree(workStart, workEnd, lunchStart, lunchEnd, occupied) {
  const sorted = [...occupied].sort((a, b) => a.start - b.start);
  const free = [];
  let cursor = workStart;
  const push = (s, e) => { if (e > s) free.push({ start: s, end: e }); };
  for (const o of sorted) {
    push(cursor, o.start);
    cursor = new Date(Math.max(cursor, o.end));
  }
  push(cursor, workEnd);
  // 扣除午餐
  const out = [];
  for (const g of free) {
    if (overlaps(g.start, g.end, lunchStart, lunchEnd)) {
      if (g.start < lunchStart) out.push({ start: g.start, end: lunchStart });
      if (lunchEnd > g.start && lunchEnd < g.end) out.push({ start: lunchEnd, end: g.end });
    } else out.push(g);
  }
  return out.sort((a, b) => a.start - b.start);
}

function fmt(d) {
  const x = new Date(d);
  return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
}

// 当前块与下一块（紧凑模式用）
function currentAndNext(blocks, now = new Date()) {
  const t = new Date(now).getTime();
  const startMs = (b) => new Date(b.start).getTime();
  const endMs = (b) => new Date(b.end).getTime();
  const current = blocks.find((b) => startMs(b) <= t && t < endMs(b)) || null;
  const next = blocks.filter((b) => startMs(b) > t).sort((a, b) => startMs(a) - startMs(b))[0] || null;
  return { current, next };
}

module.exports = { planDay, splitEstimate, currentAndNext, DEFAULTS };
