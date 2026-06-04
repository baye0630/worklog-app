/**

 * 总结生成引擎：金字塔结构 + 结果导向 + 计划/待办独立统计

 */

const SummaryEngine = (() => {

  const TYPE_LABELS = { done: '已完成', doing: '进行中', plan: '计划' };

  const LOG_TAG_OPTIONS = ['琐碎任务'];

  const DEFAULT_TAGS = LOG_TAG_OPTIONS;



  function getLogCategory(log) {

    if (log.tags?.includes('琐碎任务')) return '琐碎任务';

    if (log.project) return log.project;

    return '主要工作';

  }



  function groupByCategory(logs) {

    const map = new Map();

    for (const log of logs) {

      const cat = getLogCategory(log);

      if (!map.has(cat)) map.set(cat, []);

      map.get(cat).push(log);

    }

    return map;

  }



  function sortCategoryEntries(groupedMap) {

    const rank = (cat) => {

      if (cat === '主要工作') return 0;

      if (cat === '琐碎任务') return 2;

      return 1;

    };

    return [...groupedMap.entries()].sort((a, b) => {

      const dr = rank(a[0]) - rank(b[0]);

      return dr !== 0 ? dr : a[0].localeCompare(b[0], 'zh-CN');

    });

  }



  function formatMetaSuffix(log, { includeDate = false, includeDeadline = false } = {}) {

    const extras = [];

    if (includeDate && log.date) {

      extras.push(DateUtils.formatShort(DateUtils.parseDateKey(log.date)));

    }

    if (log.withWhom) extras.push(`与 ${log.withWhom}`);

    if (includeDeadline && log.deadline) extras.push(`DDL ${log.deadline}`);

    return extras.length ? `（${extras.join(' · ')}）` : '';

  }



  function formatResultLine(log, options = {}) {

    return `- ${log.content}${formatMetaSuffix(log, options)}`;

  }



  function buildOverviewLines(doneLogs, labelPrefix) {

    if (!doneLogs.length) return [`${labelPrefix}暂无已完成事项。`];



    const main = doneLogs.filter((l) => getLogCategory(l) !== '琐碎任务');

    const trivial = doneLogs.filter((l) => getLogCategory(l) === '琐碎任务');

    const lines = [`${labelPrefix}共完成 **${doneLogs.length}** 项`];



    const parts = [];

    if (main.length) parts.push(`主要工作 ${main.length} 项`);

    if (trivial.length) parts.push(`琐碎 ${trivial.length} 项`);

    if (parts.length) lines[0] += `（${parts.join(' · ')}）`;



    main.slice(0, 3).forEach((log) => {

      lines.push(formatResultLine(log, { includeDate: true }));

    });



    return lines;

  }



  function buildCompletedByCategory(logs, { includeDate = false } = {}) {

    if (!logs.length) return '（无）';



    const grouped = sortCategoryEntries(groupByCategory(logs));

    const blocks = [];



    for (const [cat, items] of grouped) {

      items.sort((a, b) => b.timestamp - a.timestamp);

      const lines = items.map((l) => formatResultLine(l, { includeDate })).join('\n');

      blocks.push(`#### ${cat}\n${lines}`);

    }



    return blocks.join('\n\n');

  }



  function buildDoingList(logs, { includeDate = false } = {}) {

    if (!logs.length) return '（无）';

    return logs

      .sort((a, b) => b.timestamp - a.timestamp)

      .map((l) => formatResultLine(l, { includeDate }))

      .join('\n');

  }



  function buildPlanList(logs) {

    if (!logs.length) return '（无）';

    return logs

      .sort((a, b) => b.timestamp - a.timestamp)

      .map((l) => formatResultLine(l, { includeDeadline: true }))

      .join('\n');

  }



  function buildScheduleStatusLine(schedule, dateKey, completed) {

    const dateLabel = DateUtils.formatShort(DateUtils.parseDateKey(dateKey));

    const status = completed ? '✓' : '未完成';

    return `- ${schedule.title}（${dateLabel}）${status}`;

  }



  function getLogsForDate(logs, dateKey) {

    return logs.filter((l) => l.date === dateKey);

  }



  function getLogsForWeek(logs, weekStart) {

    const keys = [];

    for (let i = 0; i < 7; i++) {

      keys.push(DateUtils.toDateKey(DateUtils.addDays(weekStart, i)));

    }

    return logs.filter((l) => keys.includes(l.date));

  }



  function generateDaily(dateKey, logs, schedules, completions) {

    const dayLogs = getLogsForDate(logs, dateKey);

    const done = dayLogs.filter((l) => l.type === 'done');

    const doing = dayLogs.filter((l) => l.type === 'doing');

    const plan = dayLogs.filter((l) => l.type === 'plan');



    const scheduleLines = ScheduleLogic.getSchedulesForDate(schedules, dateKey)

      .filter((s) => s.reminder !== false)

      .map((s) => {

        const ok = completions.some(

          (c) => c.scheduleId === s.id && c.date === dateKey && c.completed

        );

        return buildScheduleStatusLine(s, dateKey, ok);

      });



    const dateLabel = DateUtils.formatCN(DateUtils.parseDateKey(dateKey));

    let md = `## ${dateLabel} 工作日报\n\n`;

    md += `### 核心结论\n${buildOverviewLines(done, '今日').join('\n')}\n\n`;

    md += `### 已完成\n${buildCompletedByCategory(done)}\n\n`;



    if (doing.length) {

      md += `### 进行中\n${buildDoingList(doing)}\n\n`;

    }



    md += `### 计划 / 待办\n${buildPlanList(plan)}\n\n`;



    if (scheduleLines.length) {

      md += `### 固定日程\n${scheduleLines.join('\n')}\n`;

    }



    return md;

  }



  function generateWeekly(weekStart, logs, schedules, completions) {

    const weekLogs = getLogsForWeek(logs, weekStart);

    const weekEnd = DateUtils.endOfWeek(weekStart);

    const { weekId } = DateUtils.getISOWeekInfo(weekStart);

    const done = weekLogs.filter((l) => l.type === 'done');

    const doing = weekLogs.filter((l) => l.type === 'doing');

    const plan = weekLogs.filter((l) => l.type === 'plan');



    const weekScheduleItems = [];

    for (let i = 0; i < 7; i++) {

      const dk = DateUtils.toDateKey(DateUtils.addDays(weekStart, i));

      ScheduleLogic.getSchedulesForDate(schedules, dk).forEach((s) => {

        const ok = completions.some((c) => c.scheduleId === s.id && c.date === dk && c.completed);

        weekScheduleItems.push(buildScheduleStatusLine(s, dk, ok));

      });

    }



    let md = `## ${weekId} 工作周报（${DateUtils.formatShort(weekStart)} - ${DateUtils.formatShort(weekEnd)}）\n\n`;

    md += `### 本周成果概览\n${buildOverviewLines(done, '本周').join('\n')}\n\n`;

    md += `### 已完成事项\n${buildCompletedByCategory(done, { includeDate: true })}\n\n`;



    if (doing.length) {

      md += `### 进行中\n${buildDoingList(doing, { includeDate: true })}\n\n`;

    }



    md += `### 固定事项执行情况\n`;

    md += weekScheduleItems.length ? weekScheduleItems.join('\n') : '（本周无固定日程）';

    md += '\n\n';



    md += `### 计划 / 待办\n`;

    md += `本周计划 **${plan.length}** 项\n\n`;

    md += `${buildPlanList(plan)}\n\n`;

    md += `### 下周计划\n（请在此补充）\n`;



    return md;

  }



  return {

    TYPE_LABELS,

    LOG_TAG_OPTIONS,

    DEFAULT_TAGS,

    generateDaily,

    generateWeekly,

    getLogsForDate,

  };

})();



/**

 * 固定日程匹配逻辑

 */

const ScheduleLogic = (() => {

  function getSchedulesForDate(schedules, dateKey) {

    const d = DateUtils.parseDateKey(dateKey);

    return schedules.filter((s) => matchesDate(s, d));

  }



  function matchesDate(schedule, date) {
    if (schedule.startDate && dateKeyCompare(date, schedule.startDate) < 0) return false;
    if (schedule.endDate && dateKeyCompare(date, schedule.endDate) > 0) return false;

    if (schedule.startWeekId || schedule.endWeekId) {
      const { weekId } = DateUtils.getISOWeekInfo(date);
      if (schedule.startWeekId && weekId < schedule.startWeekId) return false;
      if (schedule.endWeekId && weekId > schedule.endWeekId) return false;
    }

    const type = schedule.recurrenceType || 'weekly';

    if (type === 'daily') return true;

    if (type === 'weekly') {

      const dow = date.getDay();

      const target = schedule.dayOfWeek ?? 3;

      return dow === target;

    }

    if (type === 'biweekly') {
      const dow = date.getDay();
      const target = schedule.dayOfWeek ?? 3;
      if (dow !== target) return false;

      const anchorWeekId =
        schedule.startWeekId ||
        (schedule.startDate
          ? DateUtils.getISOWeekInfo(DateUtils.parseDateKey(schedule.startDate)).weekId
          : null);
      if (!anchorWeekId) return false;

      const { weekId } = DateUtils.getISOWeekInfo(date);
      const offset = DateUtils.weeksBetweenWeekIds(anchorWeekId, weekId);
      if (offset === null || offset < 0) return false;
      return offset % 2 === 0;
    }

    if (type === 'monthly') {

      return date.getDate() === (schedule.dayOfMonth ?? 1);

    }

    return false;

  }



  function dateKeyCompare(a, bKey) {

    const ak = DateUtils.toDateKey(a);

    if (ak < bKey) return -1;

    if (ak > bKey) return 1;

    return 0;

  }



  return { getSchedulesForDate, matchesDate };

})();


