'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { rollForwardTask, applyCarryOver } = require('../core/carryover');

const now = new Date(2026, 8, 20, 8, 0);

test('昨天未完成的普通任务自动标记延续', () => {
  const task = { id: 'a', title: '写作业', status: 'todo', deadline: new Date(2026, 8, 19, 20).toISOString() };
  const next = rollForwardTask(task, now);
  assert.equal(next.carryOverFrom, task.deadline);
});

test('昨天排过但未完成的无日期任务也会延续', () => {
  const task = { id: 'a', title: '看论文', status: 'todo', lastPlannedAt: new Date(2026, 8, 19, 14).toISOString() };
  assert.equal(rollForwardTask(task, now).carryOverFrom, task.lastPlannedAt);
});

test('课程不延续，完成任务清除延续标记', () => {
  const yesterday = new Date(2026, 8, 19, 8).toISOString();
  const [course, done] = applyCarryOver([
    { title: '[课程] 强化学习', status: 'todo', fixedStart: yesterday, carryOverFrom: yesterday },
    { title: '写作业', status: 'done', carryOverFrom: yesterday },
  ], now);
  assert.equal(course.carryOverFrom, null);
  assert.equal(done.carryOverFrom, null);
});

test('未完成任务持续结转并保留最初日期', () => {
  const original = new Date(2026, 8, 18, 10).toISOString();
  const task = { title: '长期未完成', status: 'postponed', carryOverFrom: original };
  assert.equal(rollForwardTask(task, now).carryOverFrom, original);
});
