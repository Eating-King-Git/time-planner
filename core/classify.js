'use strict';
// 透明可解释的 重要/紧急 评分。全部确定性规则，无模型调用。
// 重要性(0-100) = 目标影响35 + 后果25 + 阻塞依赖20 + 对他人的责任20
// 紧迫性(0-100) = 截止接近50 + 不可逆时机25 + 逾期/阻塞25
// >=60 视为重要/紧急。
// UMD：浏览器中挂到 window.TimePlannerClassify。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TimePlannerClassify = factory();
}(typeof self !== 'undefined' ? self : this, function () {

const IMPACT_RATIO = { high: 1, medium: 0.6, low: 0.2 };
const BLOCKING_RE = /阻塞|卡住|依赖|等.{0,3}(我|这个)|blocked/i;
const RESPONSIBLE_RE = /客户|老板|领导|同事|团队|汇报|别人|他人|对方|家长/;
const IRREVERSIBLE_RE = /不可改|改不了|过期不候|仅此一次|错过不再|航班|火车|机票|演唱会|考试/;

function classify(task, now = new Date()) {
  const impact = IMPACT_RATIO[task.impact] || 0;
  const text = `${task.title || ''} ${task.text || ''}`;

  const goalImpact = Math.round(35 * impact);
  const consequence = Math.round(25 * impact);
  const blocking = task.blocking || BLOCKING_RE.test(text) ? 20 : 0;
  const responsibility = task.responsibleToOthers || RESPONSIBLE_RE.test(text) ? 20 : 0;
  const importance = Math.min(100, goalImpact + consequence + blocking + responsibility);

  const deadlineProximity = scoreDeadlineProximity(task.deadline, now);
  const irreversible = task.irreversible || IRREVERSIBLE_RE.test(text) ? 25 : 0;
  const overdueBlocking = (task.deadline && new Date(task.deadline) < now) || blocking ? 25 : 0;
  const urgency = Math.min(100, deadlineProximity + irreversible + overdueBlocking);

  let important = importance >= 60;
  let urgent = urgency >= 60;
  const overridden = task.importantOverride != null || task.urgentOverride != null;
  if (task.importantOverride != null) important = !!task.importantOverride;
  if (task.urgentOverride != null) urgent = !!task.urgentOverride;

  const quadrant = important && urgent ? 'q1' : important ? 'q2' : urgent ? 'q3' : 'q4';
  const explanation = buildExplanation({
    goalImpact, consequence, blocking, responsibility,
    deadlineProximity, irreversible, overdueBlocking, impact, now, task,
  });

  let confidence = 0.95;
  if (!task.deadline || task.vague) confidence -= 0.25;
  if (!task.durationMinutes) confidence -= 0.15;
  if (!task.impact) confidence -= 0.2;
  confidence = Math.max(0.05, Math.round(confidence * 100) / 100);

  return { importance, urgency, important, urgent, overridden, quadrant, explanation, confidence };
}

function scoreDeadlineProximity(deadline, now) {
  if (!deadline) return 0;
  const hours = (new Date(deadline) - new Date(now)) / 3600000;
  if (hours < 0) return 50; // 已逾期最紧急
  if (hours <= 4) return 50;
  if (hours <= 24) return 40;
  if (hours <= 72) return 28;
  if (hours <= 168) return 16;
  return 8;
}

function buildExplanation(p) {
  const parts = [];
  parts.push(p.impact
    ? `影响${p.task.impact === 'high' ? '很大' : p.task.impact === 'medium' ? '中等' : '较小'}：目标影响+${p.goalImpact}、后果+${p.consequence}`
    : '未提供影响信息：目标影响+0、后果+0');
  parts.push(p.blocking ? '存在阻塞/依赖：+20' : '无阻塞依赖：+0');
  parts.push(p.responsibility ? '涉及对他人的责任：+20' : '无对外责任：+0');
  const dl = p.task.deadline
    ? `截止${new Date(p.task.deadline).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    : '无明确截止';
  parts.push(`${dl}：截止接近+${p.deadlineProximity}`);
  parts.push(p.irreversible ? '时机不可逆：+25' : '时机可调整：+0');
  parts.push(p.overdueBlocking ? '已逾期或阻塞他人：+25' : '未逾期：+0');
  return parts.join('；');
}

return { classify, scoreDeadlineProximity };
}));
