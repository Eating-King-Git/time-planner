'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { isPendingConfirm, confirmationPatch } = require('../core/confirm');

test('仅识别未完成的待确认事项', () => {
  assert.equal(isPendingConfirm({ title: '待确认：会议地点', status: 'todo' }), true);
  assert.equal(isPendingConfirm({ title: '待确认: 调补课', status: 'todo' }), true);
  assert.equal(isPendingConfirm({ title: '待确认：会议地点', status: 'done' }), false);
  assert.equal(isPendingConfirm({ title: '普通任务', status: 'todo' }), false);
});

test('确认结果写入 text/source 并标记完成', () => {
  const task = { title: '待确认：会议地点', text: '请核实', source: '示例', status: 'todo' };
  const patch = confirmationPatch(task, '周三下午开会，会议室A', new Date(2026, 8, 18, 16, 5));
  assert.equal(patch.status, 'done');
  assert.match(patch.text, /确认结果 2026\/9\/18 16:05/);
  assert.match(patch.text, /会议室A/);
  assert.match(patch.source, /已确认/);
  assert.equal(confirmationPatch(task, '   '), null);
});
