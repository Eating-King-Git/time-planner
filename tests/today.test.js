'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  GUIDANCE, isCompletedToday, buildTodayItems, quadrantAllocation, todaySummary, buildUpcomingDays,
} = require('../core/today');

const day = new Date(2026, 8, 18, 12, 0);
const iso = (h, m = 0) => new Date(2026, 8, 18, h, m).toISOString();
const base = (id, extra = {}) => ({ id, title: id, status: 'todo', horizon: 'today', quadrant: 'q2', important: true, ...extra });

test('当天完成仍显示，次日从今日列表排除', () => {
  const t = base('done', { status: 'done', doneAt: iso(10) });
  assert.equal(isCompletedToday(t, day), true);
  assert.equal(buildTodayItems([t], { blocks: [] }, day).length, 1);
  assert.equal(buildTodayItems([t], { blocks: [] }, new Date(2026, 8, 19, 8)).length, 0);
});

test('长期任务多个时间块在今日只出现一次并汇总分钟', () => {
  const t = base('long', { horizon: 'long', autoSchedule: false });
  const plan = { blocks: [
    { taskId: 'long', start: iso(9), end: iso(9, 30), kind: 'task' },
    { taskId: 'long', start: iso(15), end: iso(16), kind: 'task' },
  ] };
  const items = buildTodayItems([t], plan, day);
  assert.equal(items.length, 1);
  assert.equal(items[0].minutesToday, 90);
  assert.equal(items[0].ranges.length, 2);
});

test('四象限百分比排除固定课程', () => {
  const tasks = [base('a', { quadrant: 'q1' }), base('b', { quadrant: 'q2' }), base('c')];
  const plan = { blocks: [
    { taskId: 'a', start: iso(9), end: iso(10), kind: 'task' },
    { taskId: 'b', start: iso(10), end: iso(12), kind: 'task' },
    { taskId: 'c', start: iso(14), end: iso(15), kind: 'fixed' },
  ] };
  const stats = quadrantAllocation(tasks, plan);
  assert.deepEqual(stats.minutes, { q1: 60, q2: 120, q3: 0, q4: 0 });
  assert.equal(stats.percent.q1, 33);
  assert.equal(stats.percent.q2, 67);
  assert.equal(stats.fixedMinutes, 60);
  assert.equal(Object.keys(GUIDANCE).length, 4);
});

test('今日摘要区分固定、长期、重要和其他，空闲不为负', () => {
  const tasks = [
    base('long', { horizon: 'long' }),
    base('important'),
    base('other', { important: false, quadrant: 'q3' }),
    base('course'),
  ];
  const plan = { capacityMinutes: 100, usedTaskMinutes: 150, blocks: [
    { taskId: 'course', start: iso(8), end: iso(9), kind: 'fixed' },
    { taskId: 'long', start: iso(9), end: iso(10), kind: 'task' },
    { taskId: 'important', start: iso(10), end: iso(11), kind: 'task' },
    { taskId: 'other', start: iso(11), end: iso(11, 30), kind: 'task' },
  ] };
  assert.deepEqual(todaySummary(tasks, plan), { fixedMinutes: 60, importantMinutes: 60, longMinutes: 60, otherMinutes: 30, freeMinutes: 0 });
});

test('未来排期按本地日期分组，并将同一任务每天去重', () => {
  const fixed = base('course', {
    fixedStart: new Date(2026, 8, 20, 8).toISOString(),
    fixedEnd: new Date(2026, 8, 20, 9, 40).toISOString(),
    deadline: new Date(2026, 8, 20, 18).toISOString(),
  });
  const due = base('due', { deadline: new Date(2026, 8, 19, 18).toISOString() });
  const groups = buildUpcomingDays([fixed, due], { blocks: [
    { taskId: 'course', start: fixed.fixedStart, end: fixed.fixedEnd, kind: 'fixed' },
  ] }, { now: day, days: 3 });
  assert.equal(groups.length, 3);
  assert.equal(groups[0].date, '2026-09-19');
  assert.equal(groups[0].items[0].taskId, 'due');
  assert.equal(groups[1].date, '2026-09-20');
  assert.equal(groups[1].items.length, 1);
  assert.equal(groups[1].items[0].taskId, 'course');
  assert.equal(groups[1].items[0].minutesToday, 100);
});

test('未来排期排除已完成事项且不虚构自动时间块', () => {
  const done = base('done-future', {
    status: 'done', deadline: new Date(2026, 8, 19, 18).toISOString(),
  });
  const undated = base('undated');
  const groups = buildUpcomingDays([done, undated], { blocks: [] }, { now: day, days: 3 });
  assert.ok(groups.every((g) => g.items.length === 0));
});

test('延续任务即使当天无时间块也显示在今天', () => {
  const task = base('carry', { carryOverFrom: new Date(2026, 8, 19, 15).toISOString(), deadline: null });
  const items = buildTodayItems([task], { blocks: [] }, day);
  assert.equal(items.length, 1);
  assert.equal(items[0].carriedOver, true);
});
