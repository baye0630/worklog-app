/**
 * 日期工具：周起始日为周一
 */
const DateUtils = (() => {
  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function toDateKey(d) {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  }

  function parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function startOfDay(d) {
    const dt = new Date(d);
    dt.setHours(0, 0, 0, 0);
    return dt;
  }

  function addDays(d, n) {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt;
  }

  /** 周一为一周起始 */
  function startOfWeek(d) {
    const dt = startOfDay(d);
    const day = dt.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    return addDays(dt, diff);
  }

  function endOfWeek(d) {
    return addDays(startOfWeek(d), 6);
  }

  function getISOWeekInfo(d) {
    const date = startOfDay(d);
    const thursday = addDays(date, 3 - ((date.getDay() + 6) % 7));
    const yearStart = new Date(thursday.getFullYear(), 0, 4);
    const week =
      1 +
      Math.round(
        ((thursday - startOfWeek(yearStart)) / 86400000) / 7
      );
    return { year: thursday.getFullYear(), week, weekId: `${thursday.getFullYear()}-W${pad(week)}` };
  }

  function formatCN(d) {
    const dt = new Date(d);
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日 周${weekdays[dt.getDay()]}`;
  }

  function formatShort(d) {
    const dt = new Date(d);
    return `${pad(dt.getMonth() + 1)}.${pad(dt.getDate())}`;
  }

  function formatTime(ts) {
    const dt = new Date(ts);
    return `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  }

  function monthMatrix(year, month) {
    const first = new Date(year, month, 1);
    const start = startOfWeek(first);
    const weeks = [];
    let cur = new Date(start);
    for (let w = 0; w < 6; w++) {
      const row = [];
      for (let i = 0; i < 7; i++) {
        row.push(new Date(cur));
        cur = addDays(cur, 1);
      }
      weeks.push(row);
      if (w >= 4 && cur.getMonth() !== month && cur.getDate() > 7) break;
    }
    return weeks;
  }

  function sameDay(a, b) {
    return toDateKey(a) === toDateKey(b);
  }

  function isToday(d) {
    return sameDay(d, new Date());
  }

  function parseWeekId(weekId) {
    const m = /^(\d{4})-W(\d{2})$/.exec(String(weekId || ''));
    if (!m) return null;
    return { year: Number(m[1]), week: Number(m[2]) };
  }

  /** ISO 周 ID → 该周周一 */
  function weekStartFromWeekId(weekId) {
    const parsed = parseWeekId(weekId);
    if (!parsed) return null;
    const jan4 = new Date(parsed.year, 0, 4);
    const week1Monday = startOfWeek(jan4);
    return addDays(week1Monday, (parsed.week - 1) * 7);
  }

  function weekRangeFromIds(startWeekId, endWeekId) {
    const result = { startDate: '', endDate: '' };
    if (startWeekId) {
      const start = weekStartFromWeekId(startWeekId);
      if (start) result.startDate = toDateKey(start);
    }
    if (endWeekId) {
      const endMon = weekStartFromWeekId(endWeekId);
      if (endMon) result.endDate = toDateKey(endOfWeek(endMon));
    }
    return result;
  }

  function currentWeekId() {
    return getISOWeekInfo(new Date()).weekId;
  }

  /** 两 ISO 周之间的周数差（to − from，不可解析时返回 null） */
  function weeksBetweenWeekIds(fromWeekId, toWeekId) {
    const fromStart = weekStartFromWeekId(fromWeekId);
    const toStart = weekStartFromWeekId(toWeekId);
    if (!fromStart || !toStart) return null;
    return Math.round((toStart - fromStart) / 604800000);
  }

  return {
    toDateKey,
    parseDateKey,
    startOfDay,
    addDays,
    startOfWeek,
    endOfWeek,
    getISOWeekInfo,
    formatCN,
    formatShort,
    formatTime,
    monthMatrix,
    sameDay,
    isToday,
    parseWeekId,
    weekStartFromWeekId,
    weekRangeFromIds,
    currentWeekId,
    weeksBetweenWeekIds,
  };
})();
