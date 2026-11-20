/* global TimePlannerParse, TimePlannerClassify, TimePlannerToday, TimePlannerConfirm */
'use strict';
// 渲染进程：全部用户文本经 textContent 注入，绝不使用 innerHTML。

const $ = (id) => document.getElementById(id);
const parseTask = TimePlannerParse.parseTask;
const classify = TimePlannerClassify.classify;

const state = {
  tasks: [], plan: null, settings: null, compact: true,
  compactTab: 'today',
  editingId: null,
  confirmingId: null,
  draft: null,          // 当前合成草稿（预览用）
  overrides: { important: null, urgent: null },
};

// ---------- 工具 ----------
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text; // 用户文本只走 textContent
  return n;
}
function fmtDT(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtHM(iso) { return iso ? fmtDT(iso).slice(-5) : ''; }
function taskDate(t) { return t.fixedStart || (t.block && t.block.start) || t.deadline || null; }
function isOverdue(t, now = new Date()) { return t.status !== 'done' && t.deadline && new Date(t.deadline) < now; }
function carryLabel(t, now = new Date()) {
  if (!t.carryOverFrom) return '';
  const from = new Date(t.carryOverFrom);
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.max(1, Math.round((b - a) / 86400000));
  return days === 1 ? '昨日延续' : `已延续${days}天`;
}
function isLongTask(t, now = new Date()) {
  if (t.status === 'done') return false;
  const d = taskDate(t);
  return t.horizon === 'long' || (d && new Date(d).setHours(0, 0, 0, 0) > new Date(now).setHours(0, 0, 0, 0));
}
function toLocalInput(d) {
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function toast(msg, actionLabel, onAction) {
  const t = $('toast');
  t.textContent = '';
  t.append(el('span', null, msg));
  if (actionLabel) {
    const b = el('button', null, actionLabel);
    b.onclick = () => { hideToast(); onAction(); };
    t.append(b);
  }
  const close = el('button', 'toast-close', '×');
  close.title = '关闭提示';
  close.onclick = hideToast;
  t.append(close);
  t.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(hideToast, actionLabel ? 10000 : 2000);
}
function hideToast() {
  clearTimeout(toast._timer);
  $('toast').hidden = true;
}
function showError(res) { if (res && res.error) toast(`错误：${res.error}`); }

// ---------- 草稿合成：解析文本 + 结构化字段（字段优先，绝不臆造）----------
function composeDraft() {
  const now = new Date();
  const text = $('capture-input').value.trim();
  const parsed = parseTask(text, now);
  const val = (id) => $(id).value;
  const num = (id) => { const n = Number(val(id)); return Number.isFinite(n) && n > 0 ? n : null; };

  let deadline = val('f-deadline') ? new Date(val('f-deadline')).toISOString() : (parsed.deadline ? parsed.deadline.toISOString() : null);
  let fixedStart = val('f-fixed-start') ? new Date(val('f-fixed-start')).toISOString() : (parsed.fixedStart ? parsed.fixedStart.toISOString() : null);
  let fixedEnd = val('f-fixed-end') ? new Date(val('f-fixed-end')).toISOString() : (parsed.fixedEnd ? parsed.fixedEnd.toISOString() : null);
  const durationMinutes = num('f-duration') || parsed.durationMinutes;
  const impact = val('f-impact') || parsed.impact;
  const horizon = val('f-horizon') || 'today';

  if (fixedStart && !fixedEnd && durationMinutes) {
    fixedEnd = new Date(new Date(fixedStart).getTime() + durationMinutes * 60000).toISOString();
  }
  const taskLike = {
    title: parsed.title || text, text,
    deadline, fixedStart, fixedEnd, durationMinutes, impact, horizon,
    vague: parsed.vague,
    importantOverride: state.overrides.important,
    urgentOverride: state.overrides.urgent,
  };
  const scored = classify(taskLike, now);
  state.draft = { ...taskLike, ...scored, needs: parsed.needs };
  return state.draft;
}

function refreshPreview() {
  const d = composeDraft();
  const hasInput = $('capture-input').value.trim() || state.editingId;
  renderClarify(d, hasInput);
  renderPreview(d, hasInput);
  renderQuadrantPreview(d, !!hasInput);
}

function renderQuadrantPreview(draft, hasInput) {
  const box = $('quadrant-preview');
  box.textContent = '';
  const allocation = TimePlannerToday.quadrantAllocation(state.tasks, state.plan || {});
  const unfinished = state.tasks.filter((t) => t.status !== 'done' && !String(t.title).startsWith('[课程]'));
  if (hasInput) {
    const guide = TimePlannerToday.GUIDANCE[draft.quadrant];
    box.append(el('div', 'quadrant-draft', `当前输入 → ${guide.name}　重要性 ${draft.importance} / 紧迫性 ${draft.urgency}　${guide.action}`));
  } else box.append(el('div', 'quadrant-draft', '输入任务后，这里会实时高亮所属象限'));
  const grid = el('div', 'quadrant-grid');
  for (const q of ['q1', 'q2', 'q3', 'q4']) {
    const guide = TimePlannerToday.GUIDANCE[q];
    const cell = el('div', `quadrant-cell ${q}${hasInput && draft.quadrant === q ? ' active' : ''}`);
    cell.append(el('div', 'quadrant-name', `${guide.name} · ${guide.share}`));
    cell.append(el('div', 'quadrant-types', `${guide.types}｜${guide.action}`));
    cell.append(el('div', 'quadrant-allocation', `今日已排 ${allocation.minutes[q]} 分钟 · ${allocation.percent[q]}%`));
    const names = unfinished.filter((t) => t.quadrant === q).map((t) => t.title);
    const shown = names.slice(0, 3).join('、') || '暂无任务';
    cell.append(el('div', 'quadrant-tasks', names.length > 3 ? `${shown} 等${names.length}项` : shown));
    grid.append(cell);
  }
  box.append(grid);
  box.append(el('div', 'fixed-allocation', `课程/固定事件：${allocation.fixedMinutes} 分钟（不计入四象限比例）`));
}

// ---------- 澄清行 ----------
const CLARIFY_CHOICES = {
  deadline: (now) => {
    const at = (h, m, addDays) => { const x = new Date(now); x.setDate(x.getDate() + addDays); x.setHours(h, m, 0, 0); return x.toISOString(); };
    return [['今天 18:00', at(18, 0, 0)], ['明天 10:00', at(10, 0, 1)], ['明天 18:00', at(18, 0, 1)], ['后天 18:00', at(18, 0, 2)]];
  },
  duration: () => [['15 分钟', 15], ['30 分钟', 30], ['1 小时', 60], ['2 小时', 120]],
  impact: () => [['影响大', 'high'], ['影响中', 'medium'], ['影响小', 'low']],
};
const NEED_LABEL = { deadline: '缺少截止：请选择一个时间（或输入具体日期）', duration: '缺少时长：任务要多久？', impact: '缺少影响：这件事的后果有多大？' };

function renderClarify(d, visible) {
  const row = $('clarify-row');
  row.textContent = '';
  const needs = (d.needs || []).filter((n) => !(n === 'deadline' && $('f-deadline').value));
  if (!visible || !needs.length) { row.hidden = true; return; }
  row.hidden = false;
  if (d.vague) row.append(el('div', 'need-item', '⚠ 表达较模糊（尽快/有空等），请明确具体时间'));
  const now = new Date();
  for (const n of needs) {
    const item = el('div', 'need-item');
    item.append(el('span', null, NEED_LABEL[n] || `缺少${n}`));
    for (const [label, value] of CLARIFY_CHOICES[n](now)) {
      const chip = el('button', 'chip', label);
      chip.onclick = () => applyClarify(n, value);
      item.append(chip);
    }
    row.append(item);
  }
}

function applyClarify(need, value) {
  if (need === 'deadline') $('f-deadline').value = toLocalInput(new Date(value));
  if (need === 'duration') $('f-duration').value = value;
  if (need === 'impact') $('f-impact').value = value;
  refreshPreview();
}

// ---------- 预览卡 ----------
function renderPreview(d, visible) {
  const card = $('preview-card');
  card.textContent = '';
  $('btn-save').disabled = !visible;
  if (!visible) { card.hidden = true; return; }
  card.hidden = false;
  const qNames = { q1: '重要且紧急', q2: '重要不紧急', q3: '紧急不重要', q4: '不重要不紧急' };
  card.append(el('div', 'label', state.editingId ? '编辑任务预览' : '新任务预览'));
  const scores = el('div', 'scores');
  scores.append(el('span', null, `重要性 ${d.importance}/100`));
  scores.append(el('span', null, `紧迫性 ${d.urgency}/100`));
  scores.append(el('span', null, `象限：${qNames[d.quadrant]}`));
  scores.append(el('span', null, `置信度 ${(d.confidence * 100).toFixed(0)}%`));
  card.append(scores);
  const facts = [];
  facts.push(`截止：${d.deadline ? fmtDT(d.deadline) : '未指定'}`);
  facts.push(`时长：${d.durationMinutes ? d.durationMinutes + ' 分钟' : '未指定'}`);
  facts.push(`影响：${{ high: '大', medium: '中', low: '小' }[d.impact] || '未指定'}`);
  if (d.fixedStart) facts.push(`固定：${fmtDT(d.fixedStart)} ~ ${fmtDT(d.fixedEnd)}`);
  card.append(el('div', 'explain', facts.join('　')));
  card.append(el('div', 'explain', `依据：${d.explanation}`));
  const ov = el('div', 'override');
  ov.append(el('span', 'sub-text', '手动标记：'));
  for (const key of ['important', 'urgent']) {
    const label = key === 'important' ? '重要' : '紧急';
    const cur = state.overrides[key] != null ? state.overrides[key] : d[key];
    const b = el('button', 'chip', `${label}${cur ? '✓' : ''}`);
    b.onclick = () => {
      const base = state.overrides[key] != null ? state.overrides[key] : d[key];
      state.overrides[key] = !base;
      refreshPreview();
    };
    ov.append(b);
  }
  card.append(ov);
}

// ---------- 保存 ----------
async function saveDraft() {
  const d = composeDraft();
  if (!d.title) { toast('请输入任务内容'); return; }
  const res = await window.api.saveTask({ ...d, id: state.editingId || undefined });
  showError(res);
  if (!res || res.error) return;
  clearCapture();
  toast(state.editingId ? '已保存修改' : '任务已保存');
}

function clearCapture() {
  $('capture-input').value = '';
  for (const id of ['f-deadline', 'f-duration', 'f-impact', 'f-fixed-start', 'f-fixed-end']) $(id).value = '';
  $('f-horizon').value = 'today';
  state.editingId = null;
  state.overrides = { important: null, urgent: null };
  refreshPreview();
}

function editTask(t) {
  state.editingId = t.id;
  $('capture-input').value = t.text || t.title;
  $('f-deadline').value = toLocalInput(t.deadline ? new Date(t.deadline) : null);
  $('f-duration').value = t.durationMinutes || '';
  $('f-impact').value = t.impact || '';
  $('f-horizon').value = t.horizon || 'today';
  $('f-fixed-start').value = toLocalInput(t.fixedStart ? new Date(t.fixedStart) : null);
  $('f-fixed-end').value = toLocalInput(t.fixedEnd ? new Date(t.fixedEnd) : null);
  state.overrides = { important: t.importantOverride, urgent: t.urgentOverride };
  refreshPreview();
  $('capture-input').focus();
}

// ---------- 矩阵 ----------
function renderMatrix() {
  const matrix = $('matrix');
  matrix.textContent = '';
  const defs = [
    ['q1', '重要且紧急', 'var(--q1)'],
    ['q2', '重要不紧急', 'var(--q2)'],
    ['q3', '紧急不重要', 'var(--q3)'],
    ['q4', '不重要不紧急', 'var(--q4)'],
  ];
  // 固定课程放在时间线/今日与未来列表中，不塞进任务四象限。
  const unfinished = state.tasks.filter((t) => t.status !== 'done' && !String(t.title).startsWith('[课程]'));
  for (const [q, name, color] of defs) {
    const cell = el('div', 'quadrant');
    const h = el('h3');
    const dot = el('span', 'dot'); dot.style.background = color;
    h.append(dot, document.createTextNode(`${name}（${unfinished.filter((t) => t.quadrant === q).length}）`));
    cell.append(h);
    const list = unfinished.filter((t) => t.quadrant === q);
    if (!list.length) cell.append(el('div', 'empty', '暂无任务'));
    for (const t of list) cell.append(renderTaskCard(t));
    matrix.append(cell);
  }
}

function renderTaskCard(t) {
  const card = el('div', 'task-card');
  if (t.locked) card.classList.add('locked-card');
  card.append(el('div', 't-title', t.title));
  const meta = [];
  meta.push(`重要性${t.importance} · 紧迫性${t.urgency}`);
  if (t.deadline) meta.push(`截止 ${fmtDT(t.deadline)}`);
  if (t.durationMinutes) meta.push(`${t.durationMinutes}分钟`);
  if (t.block) meta.push(`已排 ${fmtHM(t.block.start)}`);
  card.append(el('div', 't-meta', meta.join(' · ')));

  const actions = el('div', 't-actions');
  const mk = (label, cls, fn) => { const b = el('button', cls, label); b.onclick = fn; return b; };
  if (t.status !== 'done') {
    actions.append(mk('完成', 'primary', async () => showError(await window.api.updateTask(t.id, { status: 'done' }))));
    actions.append(mk('推迟', null, async () => showError(await window.api.updateTask(t.id, { status: 'postponed', block: null }))));
  } else {
    actions.append(mk('恢复', null, async () => showError(await window.api.updateTask(t.id, { status: 'todo' }))));
  }
  actions.append(mk('编辑', null, () => editTask(t)));
  actions.append(mk(t.locked ? '解锁' : '锁定', t.locked ? null : 'chip', async () =>
    showError(await window.api.updateTask(t.id, { locked: !t.locked }))));
  actions.append(mk('删除', 'danger', async () => {
    if (!window.confirm(`确定删除「${t.title}」吗？可在 10 秒内撤销。`)) return;
    const res = await window.api.deleteTask(t.id);
    showError(res);
    if (res && res.removed) {
      toast(`已删除「${t.title}」`, '撤销', async () => showError(await window.api.restoreTask(res.removed)));
    }
  }));
  card.append(actions);
  return card;
}

// ---------- 高密度任务列表与逾期确认 ----------
function renderDenseRow(t, todayItem = null, options = {}) {
  const completedToday = TimePlannerToday.isCompletedToday(t);
  const carriedOver = !!todayItem?.carriedOver;
  const row = el('div', `dense-row ${t.quadrant || 'q4'}${isOverdue(t) ? ' overdue' : ''}${completedToday ? ' done-today' : ''}${carriedOver ? ' carried-over' : ''}`);
  const done = el('button', 'dense-check', completedToday ? '☑' : '□');
  done.title = completedToday ? '恢复为待办' : '标记完成';
  done.onclick = async () => showError(await window.api.updateTask(t.id, { status: completedToday ? 'todo' : 'done' }));
  const main = el('div', 'dense-main');
  main.append(el('div', 'dense-title', t.title));
  let when;
  if (completedToday) when = `已完成 ${fmtHM(t.doneAt || t.updatedAt)}`;
  else if (todayItem && todayItem.ranges.length) {
    const now = Date.now();
    const range = todayItem.ranges.find((r) => r.start.getTime() <= now && now < r.end.getTime()) ||
      todayItem.ranges.find((r) => r.end.getTime() > now) || todayItem.ranges[todayItem.ranges.length - 1];
    const prefix = options.future ? (todayItem.ranges.length > 1 ? `共${todayItem.minutesToday}分钟 · ` : '') : `今日共${todayItem.minutesToday}分钟 · `;
    when = `${prefix}${fmtHM(range.start)}–${fmtHM(range.end)}`;
  } else when = t.fixedStart ? `${fmtHM(t.fixedStart)}–${fmtHM(t.fixedEnd)}` : t.deadline ? `截止 ${fmtDT(t.deadline)}` : '未设日期';
  const place = t.location ? ` · ${t.location}` : '';
  const carry = carriedOver ? `${carryLabel(t)} · ` : '';
  main.append(el('div', 'dense-meta', `${carry}${when}${place}`));
  const controls = el('div', 'dense-controls');
  if (TimePlannerConfirm.isPendingConfirm(t)) {
    const handle = el('button', 'dense-handle', state.confirmingId === t.id ? '收起' : '处理');
    handle.onclick = () => {
      state.confirmingId = state.confirmingId === t.id ? null : t.id;
      renderAll();
      if (!state.compact && state.confirmingId) $('pending-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    controls.append(handle);
  }
  const edit = el('button', 'dense-edit', '改');
  edit.onclick = async () => {
    editTask(t);
    if (state.compact) await toggleMode();
  };
  controls.append(edit);
  row.append(done, main, controls);
  if (state.confirmingId === t.id && TimePlannerConfirm.isPendingConfirm(t) && (state.compact || options.confirmInline)) {
    const form = el('div', 'confirm-form');
    const input = el('textarea', 'confirm-input');
    input.rows = 2;
    input.maxLength = 300;
    input.placeholder = '填写确认结果，例如：会议改到周三下午，地点已核实';
    const actions = el('div', 'confirm-actions');
    const apply = el('button', 'primary', '确认并应用');
    apply.onclick = async () => {
      const patch = TimePlannerConfirm.confirmationPatch(t, input.value, new Date());
      if (!patch) { toast('请先填写确认结果'); input.focus(); return; }
      const res = await window.api.updateTask(t.id, patch);
      showError(res);
      if (!res || res.error) return;
      state.confirmingId = null;
      toast('确认结果已保存');
    };
    const later = el('button', null, '稍后');
    later.onclick = () => { state.confirmingId = null; renderAll(); };
    actions.append(apply, later);
    form.append(input, actions);
    row.append(form);
  }
  return row;
}

function fillTodayList(id, items, limit = Infinity) {
  const box = $(id);
  box.textContent = '';
  const visible = items.slice(0, limit);
  if (!visible.length) box.append(el('div', 'dense-empty', '暂无事项'));
  for (const item of visible) box.append(renderDenseRow(item.task, item));
}

function fillDenseList(id, items, limit = Infinity, options = {}) {
  const box = $(id);
  box.textContent = '';
  const sorted = [...items].sort((a, b) => {
    const da = taskDate(a) ? new Date(taskDate(a)).getTime() : Infinity;
    const db = taskDate(b) ? new Date(taskDate(b)).getTime() : Infinity;
    return da - db || (b.importance || 0) - (a.importance || 0);
  }).slice(0, limit);
  if (!sorted.length) box.append(el('div', 'dense-empty', '暂无事项'));
  for (const t of sorted) box.append(renderDenseRow(t, null, options));
}

function renderUpcomingInto(id, groups, limit = Infinity) {
  const box = $(id);
  box.textContent = '';
  let shown = 0;
  for (const group of groups) {
    const section = el('div', 'upcoming-day');
    const total = group.items.reduce((sum, item) => sum + item.minutesToday, 0);
    section.append(el('div', 'upcoming-day-head', `${group.label} · ${group.items.length}项${total ? ` · ${total}分钟` : ''}`));
    if (!group.items.length) section.append(el('div', 'dense-empty', '暂无已知安排'));
    for (const item of group.items) {
      if (shown >= limit) break;
      section.append(renderDenseRow(item.task, item, { future: true }));
      shown += 1;
    }
    box.append(section);
    if (shown >= limit) break;
  }
}

function renderPendingPanel() {
  const tasks = state.tasks.filter(TimePlannerConfirm.isPendingConfirm);
  const panel = $('pending-panel');
  panel.hidden = !tasks.length;
  $('pending-count').textContent = tasks.length;
  if (tasks.length) fillDenseList('pending-list', tasks, Infinity, { confirmInline: true });
}

function renderDenseLists() {
  const today = TimePlannerToday.buildTodayItems(state.tasks, state.plan || {}, new Date());
  const upcoming3 = TimePlannerToday.buildUpcomingDays(state.tasks, state.plan || {}, { days: 3, now: new Date() });
  const upcoming7 = TimePlannerToday.buildUpcomingDays(state.tasks, state.plan || {}, { days: 7, now: new Date() });
  const long = state.tasks.filter((t) => isLongTask(t));
  $('today-count').textContent = today.length;
  $('long-count').textContent = long.length;
  fillTodayList('today-list', today);
  fillDenseList('long-list', long);
  if (state.compactTab === 'today') fillTodayList('compact-list', today, 9);
  else if (state.compactTab === 'upcoming') renderUpcomingInto('compact-list', upcoming3, 12);
  else fillDenseList('compact-list', long, 9);
  renderUpcomingInto('upcoming-list', upcoming7);
  $('tab-compact-today').classList.toggle('active', state.compactTab === 'today');
  $('tab-compact-upcoming').classList.toggle('active', state.compactTab === 'upcoming');
  $('tab-compact-long').classList.toggle('active', state.compactTab === 'long');
  const overdue = state.tasks.filter((t) => isOverdue(t));
  $('compact-stats').textContent = '';
  for (const label of [`今日 ${today.length}`, `逾期 ${overdue.length}`, `长期 ${long.length}`]) $('compact-stats').append(el('span', null, label));
}

function renderTodaySummary() {
  const summary = TimePlannerToday.todaySummary(state.tasks, state.plan || {});
  const box = $('today-summary');
  box.textContent = '';
  for (const label of [
    `课程/固定 ${summary.fixedMinutes}分`, `重要 ${summary.importantMinutes}分`,
    `长期 ${summary.longMinutes}分`, `其他 ${summary.otherMinutes}分`, `空闲/缓冲 ${summary.freeMinutes}分`,
  ]) box.append(el('span', null, label));
}

function renderOverdueInto(id) {
  const box = $(id);
  const overdue = state.tasks.filter((t) => isOverdue(t));
  box.textContent = '';
  box.hidden = !overdue.length;
  if (!overdue.length) return;
  box.append(el('div', null, `⏰ ${overdue.length} 项已到截止时间，请确认状态`));
  for (const t of overdue.slice(0, 3)) {
    const line = el('div', 'overdue-line');
    line.append(el('span', null, t.title));
    const complete = el('button', 'primary', '完成');
    complete.onclick = async () => showError(await window.api.updateTask(t.id, { status: 'done' }));
    const later = el('button', null, '+30分');
    later.onclick = async () => showError(await window.api.updateTask(t.id, { deadline: new Date(Date.now() + 30 * 60000).toISOString(), status: 'todo', block: null }));
    const change = el('button', null, '改时间');
    change.onclick = async () => { editTask(t); if (state.compact) await toggleMode(); };
    line.append(complete, later, change);
    box.append(line);
  }
}

function renderOverdue() {
  renderOverdueInto('overdue-confirm');
  renderOverdueInto('overdue-confirm-full');
}

// ---------- 时间线与紧凑视图 ----------
function renderTimeline() {
  const tl = $('timeline');
  tl.textContent = '';
  const blocks = (state.plan && state.plan.blocks) || [];
  if (!blocks.length) {
    tl.append(el('div', 'empty', '今天还没有安排。添加任务后会自动生成今日时间线。'));
  }
  const colors = { fixed: 'var(--q3)', locked: 'var(--accent)', task: 'var(--q2)' };
  for (const b of blocks) {
    const row = el('div', 'tl-block');
    row.style.borderLeftColor = colors[b.kind] || 'var(--border)';
    row.append(el('span', 'tl-time', `${fmtHM(b.start)}–${fmtHM(b.end)}`));
    row.append(el('span', null, b.title));
    if (b.kind === 'fixed') row.append(el('span', 'sub-text', '固定'));
    if (b.kind === 'locked') row.append(el('span', 'sub-text', '锁定'));
    if (b.keyOutcome) row.append(el('span', 'key', '★ 关键结果'));
    tl.append(row);
  }
  const w = $('warnings');
  w.textContent = '';
  const warns = (state.plan && state.plan.warnings) || [];
  if (warns.length) {
    w.hidden = false;
    for (const item of warns) w.append(el('div', null, `⚠ ${item.message}`));
  } else w.hidden = true;
}

function renderCompact() {
  const now = Date.now();
  const blocks = ((state.plan && state.plan.blocks) || []).filter((b) => new Date(b.end).getTime() > now);
  const current = blocks.find((b) => new Date(b.start).getTime() <= now);
  const next = blocks.find((b) => new Date(b.start).getTime() > now);
  $('current-task').textContent = current ? current.title : '（空闲，无进行中的任务）';
  $('current-time').textContent = current ? `${fmtHM(current.start)} – ${fmtHM(current.end)}` : '';
  $('next-task').textContent = next ? next.title : '（今天没有更多安排了）';
  $('next-time').textContent = next ? `${fmtHM(next.start)} – ${fmtHM(next.end)}` : '';
  $('btn-done').disabled = !current;
  $('btn-postpone').disabled = !current;
  $('btn-done').onclick = async () => { if (current) showError(await window.api.updateTask(current.taskId, { status: 'done' })); };
  $('btn-postpone').onclick = async () => { if (current) showError(await window.api.updateTask(current.taskId, { status: 'postponed', block: null })); };
}

// ---------- 设置与窗口 ----------
function renderSettings() {
  if (!state.settings) return;
  $('s-quiet-start').value = state.settings.quietStart;
  $('s-quiet-end').value = state.settings.quietEnd;
  $('btn-pin').classList.toggle('active', !!state.settings.alwaysOnTop);
  $('zoom-label').textContent = `${Math.round((state.settings.zoomFactor || 1) * 100)}%`;
}
async function sendSettings(patch) { showError(await window.api.setSettings(patch)); }

function renderAll() {
  document.body.classList.toggle('compact-mode', state.compact);
  $('compact-view').hidden = !state.compact;
  $('full-view').hidden = state.compact;
  renderMatrix();
  renderDenseLists();
  renderPendingPanel();
  renderOverdue();
  renderTodaySummary();
  renderTimeline();
  renderCompact();
  renderSettings();
  refreshPreview();
}

async function boot() {
  const data = await window.api.loadData();
  state.tasks = data.tasks;
  state.plan = data.plan;
  state.settings = data.settings;
  state.compact = data.settings.compact;
  renderAll();
  scheduleDayRollover();

  window.api.onDataChanged((payload) => {
    state.tasks = payload.tasks;
    state.plan = payload.plan;
    state.settings = payload.settings;
    renderAll();
  });
  window.api.onModeChanged(({ compact, alwaysOnTop }) => {
    state.compact = compact;
    if (state.settings) state.settings.alwaysOnTop = alwaysOnTop;
    renderAll();
  });
}

let rolloverTimer = null;
function scheduleDayRollover() {
  clearTimeout(rolloverTimer);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  rolloverTimer = setTimeout(async () => {
    state.plan = await window.api.planToday();
    renderAll();
    scheduleDayRollover();
  }, Math.max(1000, next - now));
}

// ---------- 事件绑定 ----------
$('capture-input').addEventListener('input', refreshPreview);
for (const id of ['f-deadline', 'f-duration', 'f-impact', 'f-horizon', 'f-fixed-start', 'f-fixed-end']) {
  $(id).addEventListener('change', refreshPreview);
}
$('btn-save').onclick = saveDraft;
$('capture-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveDraft(); });
$('btn-replan').onclick = async () => { state.plan = await window.api.planToday(); renderAll(); toast('已重新规划（保留锁定的块）'); };
$('btn-minimize').onclick = () => window.api.minimize();
$('btn-quit').onclick = () => window.api.quit();
$('btn-pin').onclick = async () => {
  const res = await window.api.togglePin();
  if (state.settings) state.settings.alwaysOnTop = res.alwaysOnTop;
  $('btn-pin').classList.toggle('active', !!res.alwaysOnTop);
};
const toggleMode = async () => {
  const res = await window.api.setMode(!state.compact);
  if (res && !res.error) { state.compact = res.compact; renderAll(); }
};
$('btn-expand').onclick = toggleMode;
$('btn-expand2').onclick = toggleMode;
$('btn-zoom-out').onclick = async () => {
  const res = await window.api.setZoom((state.settings?.zoomFactor || 1) - 0.05);
  showError(res);
  if (!res || res.error) return;
  state.settings.zoomFactor = res.zoomFactor;
  renderSettings();
};
$('btn-zoom-in').onclick = async () => {
  const res = await window.api.setZoom((state.settings?.zoomFactor || 1) + 0.05);
  showError(res);
  if (!res || res.error) return;
  state.settings.zoomFactor = res.zoomFactor;
  renderSettings();
};
$('tab-compact-today').onclick = () => { state.compactTab = 'today'; renderDenseLists(); };
$('tab-compact-upcoming').onclick = () => { state.compactTab = 'upcoming'; renderDenseLists(); };
$('tab-compact-long').onclick = () => { state.compactTab = 'long'; renderDenseLists(); };
async function saveCompact() {
  const text = $('compact-input').value.trim();
  if (!text) return;
  $('capture-input').value = text;
  refreshPreview();
  if (state.draft && state.draft.needs && state.draft.needs.length) {
    toast('还缺少信息，已打开补充栏');
    await toggleMode();
    $('capture-input').focus();
    return;
  }
  await saveDraft();
  $('compact-input').value = '';
}
$('btn-compact-add').onclick = saveCompact;
$('compact-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveCompact(); });
$('s-quiet-start').addEventListener('change', () => sendSettings({ quietStart: $('s-quiet-start').value }));
$('s-quiet-end').addEventListener('change', () => sendSettings({ quietEnd: $('s-quiet-end').value }));

boot();
