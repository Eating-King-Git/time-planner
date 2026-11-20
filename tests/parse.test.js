'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseTask } = require('../core/parse');

// 固定“现在”：2026-09-17 是周四，上午 10:00
const NOW = new Date('2026-09-17T10:00:00');

test('今天/明天/后天/大后天', () => {
  const d = (s) => parseTask(`写报告 ${s}交`, NOW).deadline;
  assert.equal(d('今天').toISOString().slice(0, 10), '2026-09-17');
  assert.equal(d('明天').toISOString().slice(0, 10), '2026-09-18');
  assert.equal(d('后天').toISOString().slice(0, 10), '2026-09-19');
  assert.equal(d('大后天').toISOString().slice(0, 10), '2026-09-20');
});

test('本周/下周星期几（取即将到来的 occurrence）', () => {
  // 周四说“本周五”→ 明天；“本周三”→ 本周已过，取下周三(9/23)
  assert.equal(parseTask('本周五提交', NOW).deadline.toISOString().slice(0, 10), '2026-09-18');
  assert.equal(parseTask('本周三提交', NOW).deadline.toISOString().slice(0, 10), '2026-09-23');
  assert.equal(parseTask('下周一开会', NOW).deadline.toISOString().slice(0, 10), '2026-09-21');
  assert.equal(parseTask('下周三开会', NOW).deadline.toISOString().slice(0, 10), '2026-09-23');
});

test('上午/下午/晚上钟点', () => {
  assert.equal(parseTask('明天上午9点交方案', NOW).deadline.toISOString(), new Date('2026-09-18T09:00:00').toISOString());
  assert.equal(parseTask('明天下午3点半交方案', NOW).deadline.toISOString(), new Date('2026-09-18T15:30:00').toISOString());
  assert.equal(parseTask('今晚8点发邮件', NOW).deadline.toISOString(), new Date('2026-09-17T20:00:00').toISOString());
  assert.equal(parseTask('17:30 前提交', NOW).deadline.toISOString(), new Date('2026-09-17T17:30:00').toISOString());
});

test('时长：30分钟/半小时/N小时/一个半小时', () => {
  assert.equal(parseTask('整理数据 30分钟', NOW).durationMinutes, 30);
  assert.equal(parseTask('整理数据 半小时', NOW).durationMinutes, 30);
  assert.equal(parseTask('写方案 两个小时', NOW).durationMinutes, 120);
  assert.equal(parseTask('写方案 一个半小时', NOW).durationMinutes, 90);
});

test('模糊表达触发澄清，且不臆造截止', () => {
  const r = parseTask('尽快回复客户邮件', NOW);
  assert.equal(r.vague, true);
  assert.equal(r.deadline, null);
  assert.ok(r.needs.includes('deadline'));

  const r2 = parseTask('有空的时候修 bug', NOW);
  assert.equal(r2.vague, true);
  assert.ok(r2.needs.includes('deadline'));
});

test('缺失必填信息进入 needs', () => {
  const r = parseTask('写周报', NOW);
  assert.deepEqual(r.needs, ['deadline', 'duration', 'impact']);
  assert.equal(r.deadline, null);
  assert.equal(r.durationMinutes, null);
  assert.equal(r.impact, null);
});

test('完整信息不产生 needs', () => {
  const r = parseTask('明天下午3点前交报告，影响很大，需要1小时', NOW);
  assert.equal(r.deadline?.toISOString(), new Date('2026-09-18T15:00:00').toISOString());
  assert.equal(r.durationMinutes, 60);
  assert.equal(r.impact, 'high');
  assert.deepEqual(r.needs, []);
});

test('"开始" 识别为固定开始时间', () => {
  const r = parseTask('明天上午10点开始产品评审，半小时', NOW);
  assert.equal(r.fixedStart?.toISOString(), new Date('2026-09-18T10:00:00').toISOString());
  assert.equal(r.fixedEnd?.toISOString(), new Date('2026-09-18T10:30:00').toISOString());
  assert.equal(r.deadline, null);
});
