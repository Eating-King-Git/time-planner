'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { sanitizeTaskDraft, validateTask, validateSettings, validateBounds } = require('../core/validate');

test('草稿清洗：拒绝空标题，忽略非法日期', () => {
  assert.equal(sanitizeTaskDraft({ title: '   ' }), null);
  const d = sanitizeTaskDraft({ title: '写报告', deadline: 'not-a-date', durationMinutes: 99999, impact: 'huge' });
  assert.equal(d.deadline, null);
  assert.equal(d.durationMinutes, 480); // 截断到上限
  assert.equal(d.impact, null);
  assert.equal(d.horizon, 'today');
});

test('持久化任务校验：坏数据丢弃，缺省补全', () => {
  assert.equal(validateTask({ id: 'bad id!' }), null);
  assert.equal(validateTask(null), null);
  const t = validateTask({ id: 'abc-1', title: '任务', status: 'weird', importance: 999 });
  assert.equal(t.status, 'todo');
  const carried = validateTask({ id: 'carry-1', title: '延续', carryOverFrom: '2026-09-19T10:00:00Z', lastPlannedAt: '2026-09-19T09:00:00Z' });
  assert.equal(carried.carryOverFrom, '2026-09-19T10:00:00.000Z');
  assert.equal(carried.lastPlannedAt, '2026-09-19T09:00:00.000Z');
  assert.equal(t.importance, 100);
  assert.equal(t.quadrant, 'q4');
});

test('设置与窗口校验：非法安静时段回退默认', () => {
  const s = validateSettings({ quietStart: '25:00', compact: false });
  assert.equal(s.quietStart, '22:00');
  assert.equal(s.compact, false);
  assert.equal(s.zoomFactor, 1);
  assert.equal(s.compactBounds, null);
  const zoomed = validateSettings({ zoomFactor: 1.07, compactBounds: { width: 500, height: 600 } });
  assert.equal(zoomed.zoomFactor, 1.05);
  assert.equal(zoomed.compactBounds.width, 500);
  assert.equal(validateSettings({ zoomFactor: 99 }).zoomFactor, 1.3);
  const b = validateBounds({ width: 50, height: 99999 });
  assert.equal(b.width, 280);
  assert.equal(b.height, 900);
});
