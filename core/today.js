'use strict';
// 今日聚合与四象限时间统计。UMD：Node 测试与沙箱渲染进程共用。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TimePlannerToday = factory();
}(typeof self !== 'undefined' ? self : this, function () {

const GUIDANCE = {
  q1: { name: '重要且紧急', types: '截止、突发、必须立即处理', share: '20–25%', action: '立即执行' },
  q2: { name: '重要不紧急', types: '论文、学习、阅读、健康', share: '55–65%', action: '优先安排' },
  q3: { name: '紧急不重要', types: '临时通知、行政、他人催办', share: '10–15%', action: '限时处理或委托' },
  q4: { name: '不重要不紧急', types: '低价值琐事', share: '≤5%', action: '减少或删除' },
};

const toDate = (v) => (v instanceof Date ? v : new Date(v));
function validDate(v) { const d = toDate(v); return Number.isNaN(d.getTime()) ? null : d; }
function sameLocalDay(a, b = new Date()) {
  const x = validDate(a), y = validDate(b);
  return !!x && !!y && x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}
function isCompletedToday(task, now = new Date()) {
  return !!task && task.status === 'done' && sameLocalDay(task.doneAt || task.completedAt || task.updatedAt, now);
}
function blockMinutes(block) {
  const start = validDate(block.start), end = validDate(block.end);
  return start && end && end > start ? Math.round((end - start) / 60000) : 0;
}

function buildTodayItems(tasks = [], plan = {}, now = new Date()) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const grouped = new Map();
  for (const b of plan.blocks || []) {
    const task = byId.get(b.taskId);
    const start = validDate(b.start), end = validDate(b.end);
    if (!task || !start || !end || end <= start || !sameLocalDay(start, now)) continue;
    const current = grouped.get(task.id) || { minutesToday: 0, ranges: [], kinds: new Set() };
    current.minutesToday += blockMinutes(b);
    current.ranges.push({ start, end });
    current.kinds.add(b.kind || 'task');
    grouped.set(task.id, current);
  }

  const items = [];
  for (const task of tasks) {
    const completedToday = isCompletedToday(task, now);
    const group = grouped.get(task.id);
    if (task.status === 'done' && !completedToday) continue;
    const dueToday = task.status !== 'done' && task.deadline && sameLocalDay(task.deadline, now);
    const fixedToday = task.status !== 'done' && task.fixedStart && sameLocalDay(task.fixedStart, now);
    const legacyToday = task.status !== 'done' && !task.deadline && !task.fixedStart && task.horizon !== 'long';
    const carriedOver = task.status !== 'done' && !!task.carryOverFrom;
    if (!completedToday && !group && !dueToday && !fixedToday && !legacyToday && !carriedOver) continue;
    const ranges = group ? group.ranges.sort((a, b) => a.start - b.start) : [];
    items.push({
      task,
      taskId: task.id,
      minutesToday: group ? group.minutesToday : 0,
      ranges,
      kinds: group ? [...group.kinds] : [],
      completedToday,
      carriedOver,
    });
  }

  const nowMs = toDate(now).getTime();
  const sortTime = (item) => {
    const activeOrNext = item.ranges.find((r) => r.end.getTime() > nowMs);
    if (activeOrNext) return activeOrNext.start.getTime();
    if (item.ranges.length) return item.ranges[item.ranges.length - 1].start.getTime();
    const d = validDate(item.task.deadline || item.task.fixedStart);
    return d ? d.getTime() : Number.MAX_SAFE_INTEGER;
  };
  return items.sort((a, b) => Number(a.completedToday) - Number(b.completedToday) || sortTime(a) - sortTime(b));
}

function quadrantAllocation(tasks = [], plan = {}) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const minutes = { q1: 0, q2: 0, q3: 0, q4: 0 };
  let fixedMinutes = 0;
  for (const b of plan.blocks || []) {
    const mins = blockMinutes(b);
    if (b.kind === 'fixed') { fixedMinutes += mins; continue; }
    const q = byId.get(b.taskId)?.quadrant;
    minutes[['q1', 'q2', 'q3', 'q4'].includes(q) ? q : 'q4'] += mins;
  }
  const taskMinutes = Object.values(minutes).reduce((a, b) => a + b, 0);
  const percent = {};
  for (const q of Object.keys(minutes)) percent[q] = taskMinutes ? Math.round(minutes[q] * 100 / taskMinutes) : 0;
  return { minutes, percent, fixedMinutes, taskMinutes };
}

function todaySummary(tasks = [], plan = {}) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const result = { fixedMinutes: 0, importantMinutes: 0, longMinutes: 0, otherMinutes: 0, freeMinutes: 0 };
  for (const b of plan.blocks || []) {
    const mins = blockMinutes(b);
    if (b.kind === 'fixed') { result.fixedMinutes += mins; continue; }
    const task = byId.get(b.taskId);
    if (!task) { result.otherMinutes += mins; continue; }
    if (task.horizon === 'long') result.longMinutes += mins;
    else if (task.important) result.importantMinutes += mins;
    else result.otherMinutes += mins;
  }
  result.freeMinutes = Math.max(0, Math.round((plan.capacityMinutes || 0) - (plan.usedTaskMinutes || 0)));
  return result;
}

function localDateKey(value) {
  const d = validDate(value);
  if (!d) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function futureDayLabel(date, now = new Date()) {
  const d = validDate(date), base = validDate(now);
  if (!d || !base) return '';
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const baseDay = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const offset = Math.round((day - baseDay) / 86400000);
  const relative = offset === 1 ? '明天' : offset === 2 ? '后天' : `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${relative} · ${weekdays[d.getDay()]}`;
}

// 已知未来安排：固定事件、已有时间块和当天截止事项。不会虚构未来自动排程。
function buildUpcomingDays(tasks = [], plan = {}, options = {}) {
  const now = validDate(options.now) || new Date();
  const days = Math.max(1, Math.min(14, Number(options.days) || 3));
  const startOffset = Math.max(1, Number(options.startOffset) || 1);
  const blocksByTaskAndDay = new Map();

  const addRange = (taskId, startValue, endValue, kind) => {
    const start = validDate(startValue), end = validDate(endValue);
    if (!taskId || !start || !end || end <= start) return;
    const key = `${taskId}|${localDateKey(start)}`;
    const entry = blocksByTaskAndDay.get(key) || { ranges: [], kinds: new Set() };
    const rangeKey = `${start.toISOString()}|${end.toISOString()}`;
    if (!entry.ranges.some((r) => r.key === rangeKey)) entry.ranges.push({ key: rangeKey, start, end });
    entry.kinds.add(kind);
    blocksByTaskAndDay.set(key, entry);
  };

  for (const block of plan.blocks || []) addRange(block.taskId, block.start, block.end, block.kind || 'block');
  for (const task of tasks) {
    if (task.status === 'done') continue;
    if (task.fixedStart && task.fixedEnd) addRange(task.id, task.fixedStart, task.fixedEnd, 'fixed');
    if (task.block?.start && task.block?.end) addRange(task.id, task.block.start, task.block.end, 'block');
  }

  const groups = [];
  for (let offset = startOffset; offset < startOffset + days; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const dateKey = localDateKey(date);
    const items = [];
    for (const task of tasks) {
      if (task.status === 'done') continue;
      const rangeData = blocksByTaskAndDay.get(`${task.id}|${dateKey}`);
      const dueThatDay = task.deadline && localDateKey(task.deadline) === dateKey;
      if (!rangeData && !dueThatDay) continue;
      const ranges = (rangeData?.ranges || []).map(({ start, end }) => ({ start, end })).sort((a, b) => a.start - b.start);
      items.push({
        task,
        taskId: task.id,
        ranges,
        minutesToday: ranges.reduce((sum, r) => sum + Math.round((r.end - r.start) / 60000), 0),
        kinds: rangeData ? [...rangeData.kinds] : ['deadline'],
        completedToday: false,
      });
    }
    items.sort((a, b) => {
      const ta = a.ranges[0]?.start || validDate(a.task.deadline);
      const tb = b.ranges[0]?.start || validDate(b.task.deadline);
      return (ta ? ta.getTime() : Infinity) - (tb ? tb.getTime() : Infinity) || a.task.title.localeCompare(b.task.title, 'zh-CN');
    });
    groups.push({ date: dateKey, label: futureDayLabel(date, now), items });
  }
  return groups;
}

return {
  GUIDANCE, sameLocalDay, isCompletedToday, buildTodayItems, quadrantAllocation, todaySummary,
  localDateKey, futureDayLabel, buildUpcomingDays,
};
}));
