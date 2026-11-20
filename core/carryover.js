'use strict';
// 未完成任务跨日延续规则。课程不延续；普通任务会持续结转直到完成。
const toDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

function startOfLocalDay(value) {
  const d = toDate(value);
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isCourse(task) {
  return /^\[课程\]/.test(String(task?.title || '').trim());
}

function pastReference(task, now = new Date()) {
  const today = startOfLocalDay(now);
  if (!today) return null;
  const candidates = [
    task?.carryOverFrom,
    task?.lastPlannedAt,
    task?.block?.start,
    task?.fixedStart,
    task?.deadline,
  ].map(toDate).filter(Boolean).filter((d) => d < today);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => a - b)[0];
}

function rollForwardTask(task, now = new Date()) {
  if (!task || typeof task !== 'object') return task;
  if (task.status === 'done') return { ...task, carryOverFrom: null };
  if (!['todo', 'postponed'].includes(task.status) || isCourse(task)) return { ...task, carryOverFrom: null };
  const reference = pastReference(task, now);
  return reference ? { ...task, carryOverFrom: task.carryOverFrom || reference.toISOString() } : task;
}

function applyCarryOver(tasks = [], now = new Date()) {
  return tasks.map((task) => rollForwardTask(task, now));
}

module.exports = { startOfLocalDay, isCourse, pastReference, rollForwardTask, applyCarryOver };
