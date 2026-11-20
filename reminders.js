'use strict';
// 提醒调度：块开始前 10 分钟 + 截止时刻。重启后恢复未来提醒；安静时段顺延。
const { Notification } = require('electron');

function inQuietHours(date, quietStart, quietEnd) {
  const cur = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (quietStart <= quietEnd) return cur >= quietStart && cur < quietEnd;
  return cur >= quietStart || cur < quietEnd; // 跨午夜，如 22:00-08:00
}

function quietEndAfter(date, quietEnd) {
  const [h, m] = quietEnd.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  if (d <= date) d.setDate(d.getDate() + 1);
  return d;
}

function localHM(value) {
  const d = new Date(value);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

class ReminderManager {
  constructor(store, getSettings, onNotificationClick = null) {
    this.store = store; // JsonStore，data 为提醒数组
    this.getSettings = getSettings;
    this.onNotificationClick = onNotificationClick;
    this.timer = null;
  }

  // 依据当日排程重建提醒（重建当天 00:00 之后的）
  rebuild(blocks, tasks) {
    const now = new Date();
    const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const existing = new Map((this.store.data || []).map((r) => [r.id, r]));
    const desired = [];
    const keepExisting = (item) => desired.push(existing.get(item.id) || { ...item, status: 'pending' });
    for (const b of blocks || []) {
      const blockStart = new Date(b.start);
      const blockEnd = new Date(b.end);
      if (Number.isNaN(blockStart.getTime()) || Number.isNaN(blockEnd.getTime()) || blockEnd <= now) continue;
      const t = taskById.get(b.taskId);
      if (!t || t.status === 'done') continue;
      keepExisting({
        id: `pre-${b.taskId}-${blockStart.toISOString()}`,
        taskId: b.taskId,
        title: '即将开始',
        body: `「${t.title}」将于 ${localHM(blockStart)} 开始`,
        fireAt: new Date(blockStart.getTime() - 10 * 60000).toISOString(),
      });
    }
    for (const t of tasks || []) {
      if (!t.deadline || t.status === 'done') continue;
      const deadline = new Date(t.deadline);
      if (Number.isNaN(deadline.getTime())) continue;
      keepExisting({ id: `due-${t.id}-${t.deadline}`, kind: 'due', taskId: t.id, title: '到达截止', body: `「${t.title}」的截止时间是 ${localHM(t.deadline)}`, fireAt: t.deadline });
      keepExisting({
        id: `confirm-${t.id}-${t.deadline}`,
        kind: 'confirm', taskId: t.id, title: '请确认任务状态',
        body: `「${t.title}」已到截止时间：完成、推迟，还是修改时间？`,
        fireAt: new Date(deadline.getTime() + 5 * 60000).toISOString(),
      });
    }
    const seen = new Set();
    this.store.update(desired.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      const age = Date.now() - new Date(r.fireAt).getTime();
      return r.status === 'fired' ? age < 7 * 86400000 : age < (r.kind === 'confirm' ? 86400000 : 5 * 60000);
    }));
  }

  start() {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), 30000);
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  tick() {
    const now = new Date();
    const { quietStart, quietEnd } = this.getSettings();
    const due = [];
    const keep = [];
    for (const r of this.store.data || []) {
      if (r.status === 'fired') { keep.push(r); continue; }
      const fireAt = new Date(r.fireAt);
      if (fireAt <= now) {
        if (inQuietHours(now, quietStart, quietEnd)) {
          r.fireAt = quietEndAfter(now, quietEnd).toISOString(); // 安静时段：顺延到时段结束
          keep.push(r);
        } else if (now - fireAt < (r.kind === 'confirm' ? 86400000 : 5 * 60000)) {
          due.push(r);
        } // 过期太久直接丢弃
      } else keep.push(r);
    }
    for (const r of due) {
      try {
        const notice = new Notification({ title: `时间规划师 · ${r.title}`, body: r.body });
        if (this.onNotificationClick) notice.on('click', this.onNotificationClick);
        notice.show();
        keep.push({ ...r, status: 'fired', firedAt: now.toISOString() });
      } catch (err) {
        console.error('通知发送失败:', err.message);
      }
    }
    this.store.update(keep);
  }
}

module.exports = { ReminderManager, inQuietHours, quietEndAfter, localHM };
