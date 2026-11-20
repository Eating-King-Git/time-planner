'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classify } = require('../core/classify');

const NOW = new Date('2026-09-17T10:00:00');

test('阈值：>=60 为重要/紧急，59 不算', () => {
  // 高影响：importance = 35+25+20(阻塞)+0 = 80
  const t1 = classify({ title: 'x', impact: 'high', blocking: true }, NOW);
  assert.equal(t1.importance, 80);
  assert.equal(t1.important, true);

  // 影响 medium + 责任：21+15+20 = 56 < 60
  const t2 = classify({ title: '客户', impact: 'medium', responsibleToOthers: true }, NOW);
  assert.equal(t2.importance, 56);
  assert.equal(t2.important, false);

  // 截止 3 小时后：50 + 0 + 0 = 50 < 60
  const t3 = classify({ title: 'x', deadline: new Date(NOW.getTime() + 3 * 3600000).toISOString() }, NOW);
  assert.equal(t3.urgency, 50);
  assert.equal(t3.urgent, false);

  // 截止 3 小时后 + 逾期? 不，用 已逾期：50+25=75 >= 60
  const t4 = classify({ title: 'x', deadline: new Date(NOW.getTime() - 3600000).toISOString() }, NOW);
  assert.equal(t4.urgency, 75);
  assert.equal(t4.urgent, true);
});

test('象限划分', () => {
  const both = classify({ title: 'x', impact: 'high', blocking: true, deadline: new Date(NOW.getTime() - 1000).toISOString() }, NOW);
  assert.equal(both.quadrant, 'q1');
  const imp = classify({ title: 'x', impact: 'high', blocking: true }, NOW);
  assert.equal(imp.quadrant, 'q2');
  const urg = classify({ title: 'x', deadline: new Date(NOW.getTime() - 1000).toISOString() }, NOW);
  assert.equal(urg.quadrant, 'q3');
  const none = classify({ title: 'x' }, NOW);
  assert.equal(none.quadrant, 'q4');
});

test('手动覆盖优先于评分', () => {
  const t = classify({ title: 'x', importantOverride: false, urgentOverride: true }, NOW);
  assert.equal(t.important, false);
  assert.equal(t.urgent, true);
  assert.equal(t.overridden, true);
});

test('信息缺失降低置信度，信息完整高置信', () => {
  const full = classify({ title: 'x', impact: 'high', deadline: new Date(NOW.getTime() + 86400000).toISOString(), durationMinutes: 60 }, NOW);
  assert.ok(full.confidence >= 0.9);
  const missing = classify({ title: 'x', vague: true }, NOW);
  assert.ok(missing.confidence <= 0.6);
});

test('解释包含各项加分依据', () => {
  const t = classify({ title: '给客户交付', impact: 'high', blocking: true, deadline: new Date(NOW.getTime() + 3600000).toISOString() }, NOW);
  assert.match(t.explanation, /目标影响\+35/);
  assert.match(t.explanation, /阻塞\/依赖：\+20/);
  assert.match(t.explanation, /对他人的责任：\+20/);
  assert.match(t.explanation, /截止接近\+50/);
});
