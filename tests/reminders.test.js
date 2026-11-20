'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { ReminderManager, inQuietHours, quietEndAfter, localHM } = require('../reminders');

test('跨午夜安静时段判断正确', () => {
  assert.equal(inQuietHours(new Date(2026, 8, 17, 23, 0), '22:00', '08:00'), true);
  assert.equal(inQuietHours(new Date(2026, 8, 17, 7, 59), '22:00', '08:00'), true);
  assert.equal(inQuietHours(new Date(2026, 8, 17, 9, 0), '22:00', '08:00'), false);
});

test('安静时段提醒顺延到下一个结束点', () => {
  const shifted = quietEndAfter(new Date(2026, 8, 17, 23, 0), '08:00');
  assert.equal(shifted.getDate(), 18);
  assert.equal(localHM(shifted), '08:00');
});

test('截止任务同时建立到点提醒和五分钟后确认提醒', () => {
  const store = { data: [], update(value) { this.data = typeof value === 'function' ? value(this.data) : value; } };
  const manager = new ReminderManager(store, () => ({ quietStart: '22:00', quietEnd: '08:00' }));
  const deadline = new Date(Date.now() + 3600000).toISOString();
  manager.rebuild([], [{ id: 't1', title: '测试任务', status: 'todo', deadline }]);
  assert.ok(store.data.some((r) => r.id.startsWith('due-t1-')));
  const confirm = store.data.find((r) => r.id.startsWith('confirm-t1-'));
  assert.ok(confirm);
  assert.equal(new Date(confirm.fireAt) - new Date(deadline), 5 * 60000);
});
