'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { planDay, splitEstimate, currentAndNext } = require('../core/schedule');

const DAY = new Date(2026, 8, 17, 0, 0, 0); // 2026-09-17 本地时间
const NOW = new Date(2026, 8, 17, 9, 0, 0);
let seq = 0;
const task = (over = {}) => ({
  id: `t${++seq}`,
  title: `任务${seq}`,
  status: 'todo',
  durationMinutes: 60,
  important: true,
  urgent: false,
  createdAt: '2026-09-16T00:00:00.000Z',
  ...over,
});
const times = (blocks) => blocks.map((b) => `${b.start.getHours()}:${String(b.start.getMinutes()).padStart(2, '0')}-${b.end.getHours()}:${String(b.end.getMinutes()).padStart(2, '0')}`);

test('无重叠：固定事件与排程块互不重叠', () => {
  const fixed = task({ title: '评审', fixedStart: new Date(2026, 8, 17, 10, 0), fixedEnd: new Date(2026, 8, 17, 11, 0), important: false, urgent: false });
  const a = task({ title: 'A', durationMinutes: 60 });
  const b = task({ title: 'B', durationMinutes: 60 });
  const { blocks } = planDay({ tasks: [fixed, a, b], date: DAY, now: NOW });
  assert.equal(blocks.length, 3);
  const sorted = [...blocks].sort((x, y) => x.start - y.start);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].start >= sorted[i - 1].end, `重叠: ${sorted[i - 1].title} 与 ${sorted[i].title}`);
  }
  // 固定事件保持在 10:00-11:00
  const f = blocks.find((x) => x.kind === 'fixed');
  assert.equal(f.start.getHours(), 10);
  assert.equal(f.end.getHours(), 11);
  // 任务块避开了 10-11 点与午餐 12:00-13:30
  for (const blk of blocks.filter((x) => x.kind === 'task')) {
    assert.ok(!(blk.start < new Date(2026, 8, 17, 11, 0) && blk.end > new Date(2026, 8, 17, 10, 0)));
    assert.ok(!(blk.start < new Date(2026, 8, 17, 13, 30) && blk.end > new Date(2026, 8, 17, 12, 0)));
  }
});

test('固定事件冲突产生警告', () => {
  const f1 = task({ title: 'F1', fixedStart: new Date(2026, 8, 17, 10, 0), fixedEnd: new Date(2026, 8, 17, 11, 0) });
  const f2 = task({ title: 'F2', fixedStart: new Date(2026, 8, 17, 10, 30), fixedEnd: new Date(2026, 8, 17, 11, 30) });
  const { warnings } = planDay({ tasks: [f1, f2], date: DAY, now: NOW });
  assert.ok(warnings.some((w) => w.type === 'fixed-overlap'));
});

test('保留 20% 缓冲：任务占用不超过 360 分钟', () => {
  const tasks = Array.from({ length: 12 }, () => task({ durationMinutes: 60 }));
  const { blocks, usedTaskMinutes } = planDay({ tasks, date: DAY, now: NOW });
  assert.ok(usedTaskMinutes <= 360, `占用 ${usedTaskMinutes} 超过 360`);
  assert.ok(blocks.filter((b) => b.kind === 'task').length <= 6); // 每块 90 分钟(60*1.5)
});

test('首次排程按 1.5 倍膨胀并拆分为 <=90 分钟块', () => {
  const t = task({ durationMinutes: 120 });
  const { blocks } = planDay({ tasks: [t], date: DAY, now: NOW });
  const mine = blocks.filter((b) => b.taskId === t.id);
  assert.deepEqual(mine.map((b) => (b.end - b.start) / 60000), [90, 90]); // 120*1.5=180 → 90+90
  assert.deepEqual(times(mine), ['9:00-10:30', '10:30-12:00']);
});

test('优先级：重要且紧急最先排', () => {
  const q2a = task({ title: 'q2a', important: true, urgent: false, createdAt: '2026-09-15T00:00:00.000Z' });
  const q1 = task({ title: 'q1', important: true, urgent: true, createdAt: '2026-09-16T00:00:00.000Z' });
  const q2b = task({ title: 'q2b', important: true, urgent: false, createdAt: '2026-09-16T12:00:00.000Z' });
  const q3 = task({ title: 'q3', important: false, urgent: true, createdAt: '2026-09-10T00:00:00.000Z' });
  const { blocks } = planDay({ tasks: [q2a, q1, q2b, q3], date: DAY, now: NOW });
  const order = blocks.filter((b) => b.kind === 'task').map((b) => b.title);
  assert.deepEqual(order.slice(0, 4), ['q1', 'q2a', 'q2b', 'q3']);
});

test('既不重要也不紧急的任务不参与自动排程', () => {
  const t = task({ important: false, urgent: false });
  const { blocks, unscheduled } = planDay({ tasks: [t], date: DAY, now: NOW });
  assert.equal(blocks.length, 0);
  assert.deepEqual(unscheduled, []);
});

test('仅作项目标题的任务可关闭自动排程', () => {
  const t = task({ important: true, urgent: true, autoSchedule: false });
  const { blocks } = planDay({ tasks: [t], date: DAY, now: NOW });
  assert.equal(blocks.length, 0);
});

test('不可行截止产生警告', () => {
  // 截止 10:00，但 09:00-10:30 才能排完第一块（90 分钟）
  const t = task({ durationMinutes: 60, deadline: new Date(2026, 8, 17, 10, 0) });
  const { warnings } = planDay({ tasks: [t], date: DAY, now: NOW });
  assert.ok(warnings.some((w) => w.type === 'infeasible' && w.taskId === t.id));
});

test('重排保留手动锁定的块', () => {
  const locked = task({ title: '锁定', locked: true, block: { start: new Date(2026, 8, 17, 14, 0), end: new Date(2026, 8, 17, 15, 0) } });
  const other = task({ title: '其他', durationMinutes: 60 });
  const { blocks } = planDay({ tasks: [locked, other], date: DAY, now: NOW });
  const lb = blocks.find((b) => b.title === '锁定');
  assert.equal(lb.kind, 'locked');
  assert.equal(lb.start.getHours(), 14);
  // 其他任务不能插进锁定的 14:00-15:00
  const ob = blocks.find((b) => b.title === '其他');
  assert.ok(!(ob.start < new Date(2026, 8, 17, 15, 0) && ob.end > new Date(2026, 8, 17, 14, 0)));
});

test('每天最多三个关键结果', () => {
  const tasks = Array.from({ length: 5 }, (_, i) => task({ title: `k${i}`, important: true, urgent: true, createdAt: `2026-09-1${i}T00:00:00.000Z` }));
  const { blocks } = planDay({ tasks, date: DAY, now: NOW });
  assert.ok(blocks.filter((b) => b.keyOutcome).length <= 3);
  assert.ok(blocks.filter((b) => b.keyOutcome).length >= 1);
});

test('容量耗尽的任务收到 no-capacity 警告', () => {
  const tasks = Array.from({ length: 10 }, () => task({ durationMinutes: 120 }));
  const { warnings, unscheduled } = planDay({ tasks, date: DAY, now: NOW });
  assert.ok(unscheduled.length > 0);
  assert.ok(warnings.some((w) => w.type === 'no-capacity'));
});

test('多块任务放不下时不消耗后续任务的空闲容量', () => {
  const tooLarge = task({ title: '放不下', durationMinutes: 240, important: true, urgent: true });
  const small = task({ title: '能放下', durationMinutes: 30, wasScheduled: true });
  const { blocks, unscheduled } = planDay({ tasks: [tooLarge, small], date: DAY, now: new Date(2026, 8, 17, 15, 0) });
  assert.ok(unscheduled.includes(tooLarge.id));
  assert.ok(blocks.some((b) => b.taskId === small.id), '失败试排不应占掉小任务的空闲时间');
});

test('当天重排只安排当前时刻之后的时间', () => {
  const t = task({ title: '下午任务', durationMinutes: 30, wasScheduled: true });
  const now = new Date(2026, 8, 17, 15, 10, 20);
  const { blocks } = planDay({ tasks: [t], date: DAY, now });
  assert.ok(blocks.every((b) => b.kind !== 'task' || b.start >= new Date(2026, 8, 17, 15, 11)));
});

test('已完成的固定事件不再占用时间线', () => {
  const done = task({ status: 'done', fixedStart: new Date(2026, 8, 17, 10, 0), fixedEnd: new Date(2026, 8, 17, 11, 0) });
  const { blocks } = planDay({ tasks: [done], date: DAY, now: NOW });
  assert.equal(blocks.length, 0);
});

test('晚间固定课程会显示，但不会扩张白天自动排程窗口', () => {
  const evening = task({ title: '晚课', fixedStart: new Date(2026, 8, 17, 19, 0), fixedEnd: new Date(2026, 8, 17, 21, 35) });
  const daytime = task({ title: '白天任务', durationMinutes: 60, wasScheduled: true });
  const { blocks } = planDay({ tasks: [evening, daytime], date: DAY, now: NOW });
  assert.ok(blocks.some((b) => b.title === '晚课' && b.kind === 'fixed'));
  const auto = blocks.find((b) => b.title === '白天任务');
  assert.ok(auto.end <= new Date(2026, 8, 17, 18, 0));
});

test('currentAndNext 找到当前与下一块', () => {
  const a = task({ title: 'A' }); // 09:00-10:30
  const b = task({ title: 'B' }); // 10:30-12:00
  const { blocks } = planDay({ tasks: [a, b], date: DAY, now: NOW });
  const at10 = currentAndNext(blocks, new Date(2026, 8, 17, 10, 0));
  assert.equal(at10.current?.title, 'A');
  assert.equal(at10.next?.title, 'B');
  const at13 = currentAndNext(blocks, new Date(2026, 8, 17, 13, 0));
  assert.equal(at13.current, null);
  const serialized = blocks.map((b) => ({ ...b, start: b.start.toISOString(), end: b.end.toISOString() }));
  assert.equal(currentAndNext(serialized, new Date(2026, 8, 17, 10, 0)).current?.title, 'A');
});

test('过去的固定工作在标记延续后可重新排入今天', () => {
  const t = task({
    title: '昨天的论文阅读',
    fixedStart: new Date(2026, 8, 16, 14, 0),
    fixedEnd: new Date(2026, 8, 16, 15, 0),
    carryOverFrom: new Date(2026, 8, 16, 14, 0).toISOString(),
    locked: true,
  });
  const { blocks } = planDay({ tasks: [t], date: DAY, now: NOW });
  assert.ok(blocks.some((b) => b.taskId === t.id && b.kind === 'task'));
});

test('splitEstimate：尾块 <20 分钟并入前块', () => {
  assert.deepEqual(splitEstimate(180), [90, 90]);
  assert.deepEqual(splitEstimate(100), [100]); // 90 + 尾块 10 分钟并入
  assert.deepEqual(splitEstimate(30), [30]);
  assert.deepEqual(splitEstimate(110), [90, 20]);
});
