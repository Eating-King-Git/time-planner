'use strict';
// 确定性中文任务解析：识别常见时间、时长与模糊表达。不调用任何模型。
// 所有函数纯计算，now 由调用方传入以便测试。
// UMD：浏览器中挂到 window.TimePlannerParse。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TimePlannerParse = factory();
}(typeof self !== 'undefined' ? self : this, function () {

const DAY_MS = 86400000;

const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function cnNum(s) {
  if (s == null) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s === '半') return null; // 由调用处特殊处理
  if (s in CN_DIGIT) return CN_DIGIT[s];
  let m = s.match(/^十([一二三四五六七八九])?$/);
  if (m) return 10 + (m[1] ? CN_DIGIT[m[1]] : 0);
  m = s.match(/^([一二两三四五六七八九])十([一二三四五六七八九])?$/);
  if (m) return CN_DIGIT[m[1]] * 10 + (m[2] ? CN_DIGIT[m[2]] : 0);
  return null;
}

const WEEKDAYS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function at(d, h, min) { const x = startOfDay(d); x.setHours(h, min || 0, 0, 0); return x; }

const HOUR_CTX = {
  凌晨: (h) => (h === 12 ? 0 : h < 12 ? h : h),
  早上: (h) => (h === 12 ? 12 : h),
  早晨: (h) => (h === 12 ? 12 : h),
  早: (h) => (h === 12 ? 12 : h),
  上午: (h) => (h === 12 ? 12 : h),
  中午: () => 12,
  下午: (h) => (h === 12 ? 12 : h + 12),
  傍晚: (h) => (h === 12 ? 12 : h + 12),
  晚上: (h) => (h === 12 ? 0 : h + 12),
  夜里: (h) => (h === 12 ? 0 : h + 12),
  晚: (h) => (h === 12 ? 0 : h + 12),
};

const VAGUE_RE = /尽快|越快越好|随时|等闲|有空(再|的)?时候?|asap/i;
const IMPACT_HIGH_RE = /后果.{0,4}(严重|很大)|影响很(大|严重)|非常关键|必须(完成|做)|必不可少/;
const IMPACT_MED_RE = /有影响|比较重要|挺重要|挺关键/;

const DURATION_RES = [
  { re: /一个半小时/, minutes: 90 },
  { re: /([两三四五六七八九]|\d+)个半(小时|钟头)/, minutes: (m) => cnNum(m[1]) * 60 + 30 },
  { re: /半(个)?(小时|钟头)/, minutes: 30 },
  { re: /一?刻钟/, minutes: 15 },
  { re: /([两三四五六七八九十]|\d+)\s*(个)?(小时|钟头|h)/i, minutes: (m) => cnNum(m[1]) * 60 },
  { re: /([五六十]|\d+)\s*(分钟|分)/, minutes: (m) => cnNum(m[1]) },
];

const HOUR_CTX_RE = '(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|晚|早)';

// 解析 "HH:MM" 或 "上下文?X点(半|Y分)" 形式的时刻
function matchClock(text) {
  let m = text.match(new RegExp(HOUR_CTX_RE + '?\\s*(\\d{1,2})\\s*[:：]\\s*(\\d{1,2})'));
  if (m) {
    let h = parseInt(m[2], 10);
    const min = parseInt(m[3], 10);
    if (h > 23 || min > 59) return null;
    if (m[1] && HOUR_CTX[m[1]]) h = HOUR_CTX[m[1]](h);
    else if (h <= 7) h += 12; // 无上下文的小时数（如 "6点下班"）偏向下午/晚上
    return { h, min, index: m.index, length: m[0].length, raw: m[0] };
  }
  m = text.match(new RegExp(HOUR_CTX_RE + '?\\s*([零一二两三四五六七八九十]{1,3}|\\d{1,2})\\s*点\\s*((\\d{1,2}|[一二三四五六七八九]{1,2})\\s*分|半)?'));
  if (m) {
    const hRaw = m[2];
    let h = cnNum(hRaw);
    if (h == null || h > 23) return null;
    let min = 0;
    if (m[3] === '半') min = 30;
    else if (m[3]) min = cnNum(m[3].replace(/\s*分$/, '')) || 0;
    if (min > 59) return null;
    if (m[1] && HOUR_CTX[m[1]]) h = HOUR_CTX[m[1]](h);
    else if (h <= 7) h += 12;
    return { h, min, index: m.index, length: m[0].length, raw: m[0] };
  }
  m = text.match(/中午/);
  if (m) return { h: 12, min: 0, index: m.index, length: m[0].length, raw: m[0] };
  return null;
}

// 解析日期偏移（不含时刻）。返回 { day: Date, index, length, raw } 或 null
function matchDate(text, now) {
  let m = text.match(/(今天|今晚|明天|明早|明晚|后天|大后天)/);
  if (m) {
    const map = { 今天: 0, 今晚: 0, 明天: 1, 明早: 1, 明晚: 1, 后天: 2, 大后天: 3 };
    return { dayOffset: map[m[1]], index: m.index, length: m[0].length, raw: m[0] };
  }
  m = text.match(/(本|这|下)周\s*(一|二|三|四|五|六|日|天)/) || text.match(/(星期|礼拜|周)\s*(一|二|三|四|五|六|日|天)/);
  if (m) {
    const target = WEEKDAYS[m[2]];
    const todayDow = now.getDay();
    let diff = (target - todayDow + 7) % 7; // 本周：取即将到来的该星期几
    if (m[1] === '下') {
      // 下周一 = 下一个周一；周三 = 周一+2，周日 = 周一+6
      const untilNextMonday = (8 - todayDow) % 7 || 7;
      diff = untilNextMonday + (target === 0 ? 6 : target - 1);
    }
    return { dowOffset: diff, index: m.index, length: m[0].length, raw: m[0] };
  }
  return null;
}

function matchDuration(text) {
  for (const { re, minutes } of DURATION_RES) {
    const m = text.match(re);
    if (m) {
      const v = typeof minutes === 'function' ? minutes(m) : minutes;
      if (Number.isFinite(v) && v > 0) return { minutes: v, index: m.index, length: m[0].length, raw: m[0] };
    }
  }
  return null;
}

// 主入口：把自然语言中文任务解析为结构化字段。绝不臆造截止、时长或影响。
function parseTask(input, now = new Date()) {
  const text = String(input || '').trim();
  const result = {
    text,
    title: text,
    deadline: null,
    fixedStart: null,
    fixedEnd: null,
    durationMinutes: null,
    impact: null,
    vague: false,
    needs: [],
    signals: {},
  };
  if (!text) { result.needs = ['deadline', 'duration', 'impact']; return result; }

  result.vague = VAGUE_RE.test(text);
  if (IMPACT_HIGH_RE.test(text)) result.impact = 'high';
  else if (IMPACT_MED_RE.test(text)) result.impact = 'medium';

  const dur = matchDuration(text);
  if (dur) { result.durationMinutes = dur.minutes; result.signals.duration = dur.raw; }

  const date = matchDate(text, now);
  const clock = matchClock(text);
  const base = date
    ? (date.dayOffset != null ? addDays(startOfDay(now), date.dayOffset) : addDays(startOfDay(now), date.dowOffset))
    : null;

  // 角色判断：固定开始 vs 截止
  const afterTimeIdx = Math.max(date ? date.index + date.length : -1, clock ? clock.index + clock.length : -1);
  const tail = text.slice(Math.max(0, afterTimeIdx), afterTimeIdx + 6);
  const isFixed = /^\s*(开始|起)/.test(tail) || /(固定在?|定在)/.test(text);
  const isDeadlineWord = /(截止|之前|以前|前(完成|做完|交)?|内(完成|做完)?)/.test(tail) || /截止/.test(text);

  if (clock && base) {
    const dt = at(base, clock.h, clock.min);
    applyRole(result, dt, isFixed, isDeadlineWord);
    result.signals.datetime = [date.raw, clock.raw];
  } else if (clock) {
    let dt = at(now, clock.h, clock.min);
    if (dt <= now) dt = addDays(dt, 1); // 时刻已过，顺延到明天
    applyRole(result, dt, isFixed, isDeadlineWord);
    result.signals.datetime = [clock.raw];
  } else if (base) {
    // 只有日期：默认作为该日截止（当天 23:59）
    if (isFixed) {
      result.fixedStart = at(base, 9, 0);
      result.signals.datetime = [date.raw];
    } else {
      result.deadline = at(base, 23, 59);
      result.signals.datetime = [date.raw];
    }
  }

  if (result.fixedStart && result.durationMinutes) {
    result.fixedEnd = new Date(result.fixedStart.getTime() + result.durationMinutes * 60000);
  }

  // 必需要素：截止、时长、影响。模糊的“尽快/有空”不视为有效截止。
  if (result.vague || !result.deadline) result.needs.push('deadline');
  if (!result.durationMinutes) result.needs.push('duration');
  if (!result.impact) result.needs.push('impact');

  // 标题：按已识别短语的原文区间拼接剩余文本（重叠区间取并集，如“今晚/晚8点”）
  const spans = [];
  if (date) spans.push([date.index, date.index + date.length]);
  if (clock) spans.push([clock.index, clock.index + clock.length]);
  if (dur) spans.push([dur.index, dur.index + dur.length]);
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const sp of spans) {
    const top = merged[merged.length - 1];
    if (top && sp[0] <= top[1]) top[1] = Math.max(top[1], sp[1]);
    else merged.push([sp[0], sp[1]]);
  }
  let title = '';
  let last = 0;
  for (const [s, e] of merged) {
    title += text.slice(last, s);
    last = e;
  }
  title += text.slice(last);
  if (spans.length) title = title.replace(/^(前|之前|以前|内)\s*/, '');
  title = title.replace(/[，,、\s]{2,}/g, ' ').replace(/^[，,、\s]+/, '').replace(/[，,、\s]+$/, '').replace(/(在|于)$/, '').trim();
  result.title = title || text;

  return result;
}

function applyRole(result, dt, isFixed, isDeadlineWord) {
  if (isFixed && !isDeadlineWord) {
    result.fixedStart = dt;
  } else {
    result.deadline = dt;
  }
}

return { parseTask, cnNum };
}));
