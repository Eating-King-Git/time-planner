'use strict';
// “待确认”事项的识别和结果记录。UMD：Node 测试与沙箱渲染进程共用。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TimePlannerConfirm = factory();
}(typeof self !== 'undefined' ? self : this, function () {

function isPendingConfirm(task) {
  return !!task && task.status !== 'done' && /^待确认[:：]/.test(String(task.title || '').trim());
}

function localStamp(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function confirmationPatch(task, result, now = new Date()) {
  const answer = String(result || '').trim();
  if (!task || !answer) return null;
  const stamp = localStamp(now);
  const priorText = String(task.text || task.title || '').trim();
  const priorSource = String(task.source || '').trim();
  return {
    text: `${priorText}\n【确认结果 ${stamp}】${answer}`.slice(0, 500),
    source: `${priorSource ? `${priorSource}｜` : ''}已确认：${answer}`.slice(0, 120),
    status: 'done',
  };
}

return { isPendingConfirm, localStamp, confirmationPatch };
}));
