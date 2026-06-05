/**
 * 工作日志与总结 — 主应用
 */
const App = (() => {
  const IDLE_LOCK_MS = 30 * 60 * 1000;
  const SCHEDULE_COLORS = [
    '#0071e3',
    '#5856d6',
    '#34c759',
    '#ff9500',
    '#ff3b30',
    '#00c7be',
    '#af52de',
    '#ff6482',
    '#ffd60a',
    '#64d2ff',
    '#bf5af2',
    '#30b0c7',
    '#ac8e68',
    '#8e8e93',
    '#ff9f0a',
    '#5e5ce6',
  ];
  const TRIVIAL_TAG = '琐碎任务';
  const DEFAULT_DATA = () => ({
    logs: [],
    schedules: [],
    scheduleCompletions: [],
    meetings: [],
    keyProjects: [],
    dailySummaries: {},
    weeklySummaries: {},
    settings: { weekStartDay: 'monday', projectTags: [], timelineView: 'detailed', trivialFilterMode: 'all' },
  });

  let password = '';
  let data = null;
  let idleTimer = null;
  let editingLogId = null;
  let currentView = 'timeline';
  let summaryMode = 'daily';
  let summaryMdView = 'preview';
  let summarySavedText = '';
  let summaryEditorKey = '';
  let calYear = new Date().getFullYear();
  let calMonth = new Date().getMonth();
  let calSelectedDate = DateUtils.toDateKey(new Date());
  let appEventsBound = false;
  const expandedKeyProjectIds = new Set();
  const expandedMeetingIds = new Set();
  let passwordPromptResolve = null;
  let lockEventsBound = false;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function uid() {
    return crypto.randomUUID();
  }

  function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(lock, IDLE_LOCK_MS);
  }

  function lock() {
    password = '';
    data = null;
    $('#app').classList.add('hidden');
    $('#lock-screen').classList.remove('hidden');
    $('#lock-password').value = '';
    $('#lock-password-confirm').value = '';
    $('#lock-error').classList.add('hidden');
    setupLockScreen();
  }

  function promptPassword(message, title = '请输入密码') {
    return new Promise((resolve) => {
      passwordPromptResolve = resolve;
      $('#password-prompt-title').textContent = title;
      $('#password-prompt-message').textContent = message;
      const input = $('#password-prompt-input');
      input.value = '';
      $('#password-prompt-dialog').showModal();
      input.focus();
    });
  }

  function finishPasswordPrompt(value) {
    $('#password-prompt-dialog').close();
    $('#password-prompt-input').value = '';
    if (passwordPromptResolve) {
      passwordPromptResolve(value);
      passwordPromptResolve = null;
    }
  }

  async function persist() {
    await CryptoVault.saveEncrypted(password, data);
  }

  async function loadAndMigrateData(pwd) {
    data = await CryptoVault.loadEncrypted(pwd);
    if (!data) throw new Error('无数据');
    data.logs = data.logs || [];
    data.schedules = data.schedules || [];
    data.scheduleCompletions = data.scheduleCompletions || [];
    data.meetings = data.meetings || [];
    data.keyProjects = data.keyProjects || [];
    migrateKeyProjectIds();
    data.dailySummaries = data.dailySummaries || {};
    data.weeklySummaries = data.weeklySummaries || {};
    data.settings = data.settings || DEFAULT_DATA().settings;
    let needsSave = false;
    if (normalizeProjectTags()) needsSave = true;
    if (ensureScheduleColors()) needsSave = true;
    if (ensureScheduleWeekIds()) needsSave = true;
    if (needsSave) await CryptoVault.saveEncrypted(pwd, data);
    return data;
  }

  async function unlock(pwd) {
    if (!CryptoVault.isInitialized()) {
      throw new Error('暂无本地数据，请先导入加密备份');
    }
    try {
      await loadAndMigrateData(pwd);
    } catch {
      throw new Error('密码错误或数据已损坏');
    }
    password = pwd;
    $('#lock-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    initUI();
    resetIdleTimer();
  }

  async function enterAppAfterImport(pwd) {
    await loadAndMigrateData(pwd);
    password = pwd;
    $('#lock-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    initUI();
    resetIdleTimer();
  }

  function initUI() {
    initScheduleColorPicker();
    normalizeProjectTags();
    refreshProjectSelects();
    renderKeyProjectPickers();
    setScheduleWeekDefaults();
    setDateInputsToday();
    setMeetingFormTimeDefault();
    updateQuickEntryShortcutHint();
    updateTrivialFilterSwitch();
    bindEvents();
    switchView('timeline');
    renderAll();
    scrollTimelineToToday(false);
  }

  function setDateInputsToday() {
    const today = DateUtils.toDateKey(new Date());
    $('#summary-date').value = today;
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    $('#entry-time').value = now.toISOString().slice(0, 16);
  }

  function isTrivialLog(log) {
    return log.tags?.includes(TRIVIAL_TAG);
  }

  function readEntryTags() {
    return $('#entry-tag-trivial').checked ? [TRIVIAL_TAG] : [];
  }

  function readEditTags() {
    return $('#edit-tag-trivial').checked ? [TRIVIAL_TAG] : [];
  }

  function resetEntryForm() {
    $('#entry-content').value = '';
    $('#entry-with-whom').value = '';
    $('#entry-project').value = '';
    $('#entry-purpose').value = '';
    $('#entry-notes').value = '';
    $('#entry-deadline').value = '';
    $('#entry-tag-trivial').checked = false;
    $('#entry-type').value = 'done';
    renderKeyProjectPicker($('#entry-key-projects'), []);
    setDateInputsToday();
  }

  function isQuickEntryShortcut(e) {
    return (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l';
  }

  function canOpenQuickEntry() {
    if ($('#app').classList.contains('hidden')) return false;
    if ($('#entry-dialog').open) return false;
    if ($('#edit-dialog').open) return false;
    if ($('#password-prompt-dialog').open) return false;
    return true;
  }

  function quickEntryShortcutLabel() {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
    return isMac ? '⌘⇧L' : 'Ctrl+Shift+L';
  }

  function updateQuickEntryShortcutHint() {
    const label = quickEntryShortcutLabel();
    const btn = $('#btn-open-entry');
    const kbd = $('#btn-open-entry-shortcut');
    if (kbd) kbd.textContent = label;
    if (btn) btn.title = `快速录入（${label}）`;
  }

  function openEntryDialog() {
    resetEntryForm();
    refreshProjectSelects();
    $('#entry-dialog').showModal();
    $('#entry-content').focus();
  }

  function normalizeProjectTags() {
    if (!data) return false;
    if (!data.settings) {
      data.settings = { weekStartDay: 'monday', projectTags: [], timelineView: 'detailed', trivialFilterMode: 'all' };
      return true;
    }
    let changed = false;
    if (!Array.isArray(data.settings.projectTags)) {
      data.settings.projectTags = [];
      changed = true;
    }
    if (data.settings.timelineView !== 'compact' && data.settings.timelineView !== 'detailed') {
      data.settings.timelineView = 'detailed';
      changed = true;
    }
    if (!['all', 'only', 'exclude'].includes(data.settings.trivialFilterMode)) {
      data.settings.trivialFilterMode = 'all';
      changed = true;
    }
    return changed;
  }

  function getTimelineView() {
    return data?.settings?.timelineView === 'compact' ? 'compact' : 'detailed';
  }

  function updateTimelineViewToggle() {
    const view = getTimelineView();
    $$('#timeline-view-toggle [data-timeline-view]').forEach((btn) => {
      const active = btn.dataset.timelineView === view;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function getProjectTags() {
    if (!Array.isArray(data?.settings?.projectTags)) return [];
    return data.settings.projectTags;
  }

  function getOrphanProjectTags() {
    const known = new Set(getProjectTags());
    const orphans = new Set();
    data.logs.forEach((log) => {
      if (log.project && !known.has(log.project)) orphans.add(log.project);
    });
    return [...orphans].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }

  function fillProjectSelect(el, { emptyLabel = '无', selected = '' } = {}) {
    if (!el) return;
    const cur = selected || el.value;
    el.innerHTML = `<option value="">${emptyLabel}</option>`;
    getProjectTags().forEach((tag) => {
      const opt = document.createElement('option');
      opt.value = tag;
      opt.textContent = tag;
      el.appendChild(opt);
    });
    getOrphanProjectTags().forEach((tag) => {
      const opt = document.createElement('option');
      opt.value = tag;
      opt.textContent = `${tag}（已移除）`;
      el.appendChild(opt);
    });
    if ([...el.options].some((o) => o.value === cur)) el.value = cur;
  }

  function refreshProjectSelects() {
    fillProjectSelect($('#entry-project'), { emptyLabel: '无' });
    fillProjectSelect($('#edit-project'), { emptyLabel: '无' });
    fillProjectSelect($('#filter-project'), { emptyLabel: '全部' });
  }

  function renderProjectTagList() {
    const list = $('#project-tag-list');
    if (!list) return;
    list.innerHTML = '';
    if (!getProjectTags().length) {
      list.innerHTML = '<li class="hint">暂无项目标签</li>';
      return;
    }
    getProjectTags().forEach((tag) => {
      const li = document.createElement('li');
      li.className = 'project-tag-item';
      const label = document.createElement('span');
      label.textContent = tag;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-secondary';
      btn.textContent = '删除';
      btn.addEventListener('click', () => deleteProjectTag(tag));
      li.appendChild(label);
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  async function addProjectTagHandler() {
    const name = $('#new-project-tag').value.trim();
    if (!name) return;
    if (getProjectTags().includes(name)) {
      alert('该标签已存在');
      return;
    }
    normalizeProjectTags();
    data.settings.projectTags.push(name);
    await persist();
    $('#new-project-tag').value = '';
    refreshProjectSelects();
    renderProjectTagList();
  }

  async function deleteProjectTag(name) {
    if (!confirm(`确定删除项目标签「${name}」？已有记录上的标签不会丢失。`)) return;
    data.settings.projectTags = getProjectTags().filter((t) => t !== name);
    await persist();
    refreshProjectSelects();
    renderProjectTagList();
  }

  function migrateKeyProjectIds() {
    data.logs.forEach((log) => {
      if (!Array.isArray(log.keyProjectIds)) log.keyProjectIds = [];
    });
    data.schedules.forEach((sch) => {
      if (!Array.isArray(sch.keyProjectIds)) sch.keyProjectIds = [];
    });
  }

  function getKeyProjects() {
    return data?.keyProjects || [];
  }

  function getKeyProjectById(id) {
    return getKeyProjects().find((p) => p.id === id);
  }

  function nextKeyProjectColor() {
    const used = new Set(getKeyProjects().map((p) => p.color));
    for (const c of SCHEDULE_COLORS) {
      if (!used.has(c)) return c;
    }
    return SCHEDULE_COLORS[getKeyProjects().length % SCHEDULE_COLORS.length];
  }

  function renderKeyProjectPickers(selected = {}) {
    renderKeyProjectPicker($('#entry-key-projects'), selected.entry || []);
    renderKeyProjectPicker($('#edit-key-projects'), selected.edit || []);
    renderKeyProjectPicker($('#sch-key-projects'), selected.schedule || []);
  }

  function renderKeyProjectPicker(container, selectedIds = []) {
    if (!container) return;
    const projects = getKeyProjects();
    if (!projects.length) {
      container.innerHTML = '<p class="hint kp-picker-empty">请先在「关键项目」中创建项目组</p>';
      return;
    }
    container.innerHTML = projects
      .map(
        (p) => {
          const color = p.color || SCHEDULE_COLORS[0];
          return `
        <label class="kp-picker-item checkbox-label" style="--kp-color:${escapeHtml(color)}">
          <input type="checkbox" value="${escapeHtml(p.id)}" ${selectedIds.includes(p.id) ? 'checked' : ''} />
          <span class="kp-picker-name">${escapeHtml(p.name)}</span>
        </label>`;
        }
      )
      .join('');
  }

  function readKeyProjectPicker(container) {
    if (!container) return [];
    return [...container.querySelectorAll('input[type=checkbox]:checked')].map((cb) => cb.value);
  }

  function resetKeyProjectForm() {
    $('#kp-edit-id').value = '';
    $('#kp-name').value = '';
    $('#kp-notes').value = '';
    $('#kp-submit-btn').textContent = '创建项目组';
    $('#kp-cancel-edit').classList.add('hidden');
  }

  async function saveKeyProject() {
    const name = $('#kp-name').value.trim();
    if (!name) return;
    const payload = {
      name,
      notes: $('#kp-notes').value.trim(),
    };
    const editId = $('#kp-edit-id').value;
    if (editId) {
      const project = getKeyProjectById(editId);
      if (project) Object.assign(project, payload);
    } else {
      data.keyProjects.unshift({
        id: uid(),
        color: nextKeyProjectColor(),
        createdAt: Date.now(),
        ...payload,
      });
    }
    await persist();
    resetKeyProjectForm();
    renderKeyProjects();
    renderKeyProjectPickers();
  }

  function editKeyProject(project) {
    $('#kp-edit-id').value = project.id;
    $('#kp-name').value = project.name;
    $('#kp-notes').value = project.notes || '';
    $('#kp-submit-btn').textContent = '保存修改';
    $('#kp-cancel-edit').classList.remove('hidden');
    switchView('key-projects');
    $('#kp-name').focus();
  }

  async function deleteKeyProject(id) {
    const project = getKeyProjectById(id);
    if (!project) return;
    if (!confirm(`确定删除关键项目「${project.name}」？关联任务不会被删除，仅解除归属。`)) return;
    data.keyProjects = getKeyProjects().filter((p) => p.id !== id);
    data.logs.forEach((log) => {
      log.keyProjectIds = (log.keyProjectIds || []).filter((pid) => pid !== id);
    });
    data.schedules.forEach((sch) => {
      sch.keyProjectIds = (sch.keyProjectIds || []).filter((pid) => pid !== id);
    });
    expandedKeyProjectIds.delete(id);
    await persist();
    renderKeyProjects();
    renderKeyProjectPickers();
    if (currentView === 'timeline') renderTimeline();
  }

  function toggleKeyProjectCard(card, projectId) {
    if (expandedKeyProjectIds.has(projectId)) {
      expandedKeyProjectIds.delete(projectId);
      card.classList.remove('kp-card--expanded');
      card.classList.add('kp-card--collapsed');
    } else {
      expandedKeyProjectIds.add(projectId);
      card.classList.add('kp-card--expanded');
      card.classList.remove('kp-card--collapsed');
    }
    const toggle = card.querySelector('.kp-card-toggle');
    const isExpanded = expandedKeyProjectIds.has(projectId);
    if (toggle) {
      toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
      toggle.setAttribute('aria-label', isExpanded ? '折叠项目' : '展开项目');
    }
  }

  function renderKeyProjects() {
    const list = $('#kp-list');
    const empty = $('#kp-empty');
    if (!list) return;

    const projects = getKeyProjects();
    list.innerHTML = '';
    empty?.classList.toggle('hidden', projects.length > 0);
    if (!projects.length) return;

    projects.forEach((project) => {
      const logs = data.logs
        .filter((log) => log.keyProjectIds?.includes(project.id))
        .sort((a, b) => b.timestamp - a.timestamp);
      const schedules = data.schedules.filter((sch) => sch.keyProjectIds?.includes(project.id));
      const expanded = expandedKeyProjectIds.has(project.id);

      const card = document.createElement('article');
      card.className = `kp-card ${expanded ? 'kp-card--expanded' : 'kp-card--collapsed'}`;
      card.innerHTML = `
        <header class="kp-card-header">
          <button type="button" class="kp-card-toggle" aria-expanded="${expanded ? 'true' : 'false'}" aria-label="${expanded ? '折叠项目' : '展开项目'}">
            <span class="kp-card-dot" style="background:${escapeHtml(project.color || SCHEDULE_COLORS[0])}"></span>
            <div class="kp-card-heading">
              <h3 class="kp-card-title">${escapeHtml(project.name)}</h3>
              ${project.notes ? `<p class="kp-card-notes">${escapeHtml(project.notes)}</p>` : ''}
            </div>
            <span class="kp-card-chevron" aria-hidden="true">›</span>
          </button>
          <div class="kp-card-actions">
            <button type="button" class="btn-secondary btn-kp-edit">编辑</button>
            <button type="button" class="btn-secondary btn-kp-delete">删除</button>
          </div>
        </header>
        <div class="kp-card-stats">
          <span>录入任务 ${logs.length} 项</span>
          <span>固定日程 ${schedules.length} 项</span>
        </div>
        <div class="kp-card-body">
          <section class="kp-card-section">
            <h4>录入任务</h4>
            ${
              logs.length
                ? `<ul class="kp-item-list">${logs
                    .map(
                      (log) => `
                  <li>
                    <span class="type-badge type-${log.type}">${SummaryEngine.TYPE_LABELS[log.type]}</span>
                    <span class="kp-item-meta">${DateUtils.formatCN(DateUtils.parseDateKey(log.date))} ${DateUtils.formatTime(log.timestamp)}</span>
                    <p class="kp-item-text">${escapeHtml(log.content)}</p>
                  </li>`
                    )
                    .join('')}</ul>`
                : '<p class="hint">暂无关联录入任务</p>'
            }
          </section>
          <section class="kp-card-section">
            <h4>固定日程</h4>
            ${
              schedules.length
                ? `<ul class="kp-item-list">${schedules
                    .map(
                      (sch) => `
                  <li>
                    <span class="schedule-color-dot" style="background:${escapeHtml(sch.color || SCHEDULE_COLORS[0])}"></span>
                    <span class="kp-item-text">${escapeHtml(sch.title)} · ${recurrenceLabel(sch)}</span>
                  </li>`
                    )
                    .join('')}</ul>`
                : '<p class="hint">暂无关联固定日程</p>'
            }
          </section>
        </div>
      `;

      card.querySelector('.kp-card-toggle').addEventListener('click', () => toggleKeyProjectCard(card, project.id));
      card.querySelector('.btn-kp-edit').addEventListener('click', () => editKeyProject(project));
      card.querySelector('.btn-kp-delete').addEventListener('click', () => deleteKeyProject(project.id));
      list.appendChild(card);
    });
  }

  function ensureScheduleColors() {
    if (!data?.schedules?.length) return false;
    let changed = false;
    const allSame =
      data.schedules.length > 1 &&
      new Set(data.schedules.map((s) => s.color || '#2563eb')).size <= 1;
    data.schedules.forEach((s, i) => {
      if (!s.color || allSame) {
        const next = SCHEDULE_COLORS[i % SCHEDULE_COLORS.length];
        if (s.color !== next) {
          s.color = next;
          changed = true;
        }
      }
    });
    return changed;
  }

  function nextScheduleColor() {
    const used = new Set(data.schedules.map((s) => s.color));
    for (const c of SCHEDULE_COLORS) {
      if (!used.has(c)) return c;
    }
    return SCHEDULE_COLORS[data.schedules.length % SCHEDULE_COLORS.length];
  }

  function initScheduleColorPicker() {
    const wrap = $('#sch-color-picker');
    if (!wrap || wrap.dataset.ready) return;
    wrap.dataset.ready = '1';
    wrap.innerHTML = SCHEDULE_COLORS.map(
      (c) =>
        `<button type="button" class="color-chip" data-color="${c}" style="background:${c}" title="选择颜色"></button>`
    ).join('');
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('.color-chip');
      if (!btn) return;
      selectScheduleColor(btn.dataset.color);
    });
    selectScheduleColor(nextScheduleColor());
  }

  function selectScheduleColor(color) {
    const val = color || SCHEDULE_COLORS[0];
    $('#sch-color').value = val;
    $('#sch-color-picker')?.querySelectorAll('.color-chip').forEach((b) => {
      b.classList.toggle('selected', b.dataset.color === val);
    });
  }

  function bindLockEvents() {
    if (lockEventsBound) return;
    lockEventsBound = true;

    $('#lock-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleLockSubmit();
    });

    $('#lock-import-backup').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      await handleLockImport(file);
    });
  }

  function bindEvents() {
    if (appEventsBound) return;
    appEventsBound = true;

    $$('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    $('#btn-open-entry').addEventListener('click', openEntryDialog);

    $('#entry-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await addLog();
    });

    const closeEntryDialog = () => $('#entry-dialog').close();
    $('#entry-cancel').addEventListener('click', closeEntryDialog);
    $('#entry-close').addEventListener('click', closeEntryDialog);

    $('#entry-content').addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        $('#entry-form').requestSubmit();
      }
    });

    ['click', 'keydown', 'mousemove'].forEach((ev) => {
      document.addEventListener(ev, resetIdleTimer, { passive: true });
    });

    $('#btn-lock').addEventListener('click', lock);

    $('#timeline-goto-today').addEventListener('click', scrollTimelineToToday);

    $('#timeline-stats').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-filter-type]');
      if (!chip) return;
      const type = chip.dataset.filterType;
      const select = $('#filter-type');
      select.value = select.value === type ? '' : type;
      renderTimeline();
    });

    $('#filter-type').addEventListener('change', renderTimeline);
    $('#filter-project').addEventListener('change', renderTimeline);
    $('#filter-trivial').addEventListener('click', () => cycleTimelineTrivialFilter());

    $('#timeline-view-toggle').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-timeline-view]');
      if (!btn) return;
      const view = btn.dataset.timelineView;
      if (view === getTimelineView()) return;
      data.settings.timelineView = view;
      await persist();
      updateTimelineViewToggle();
      renderTimeline();
    });

    $('#btn-add-project-tag').addEventListener('click', () => addProjectTagHandler());
    $('#new-project-tag').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addProjectTagHandler();
      }
    });

    $$('.tab[data-summary]').forEach((tab) => {
      tab.addEventListener('click', async () => {
        await flushSummaryToStorage();
        $$('.tab[data-summary]').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        summaryMode = tab.dataset.summary;
        renderSummary();
      });
    });

    $('#summary-prev').addEventListener('click', async () => {
      await flushSummaryToStorage();
      shiftSummaryDate(summaryMode === 'daily' ? -1 : -7);
    });
    $('#summary-next').addEventListener('click', async () => {
      await flushSummaryToStorage();
      shiftSummaryDate(summaryMode === 'daily' ? 1 : 7);
    });
    $('#summary-date').addEventListener('change', async () => {
      await flushSummaryToStorage();
      renderSummary();
    });

    $$('.tab[data-md-view]').forEach((tab) => {
      tab.addEventListener('click', () => {
        setSummaryMdView(tab.dataset.mdView);
      });
    });

    $('#btn-save-summary').addEventListener('click', () => saveSummary(true));
    $('#btn-regenerate').addEventListener('click', async () => {
      if (isSummaryDirty() && !confirm('重新生成将覆盖当前修改，是否继续？')) return;
      await flushSummaryToStorage();
      if (summaryMode === 'daily') delete data.dailySummaries[getSummaryDateKey()];
      else delete data.weeklySummaries[getWeekId()];
      await persist();
      renderSummary();
    });

    $('#btn-copy-summary').addEventListener('click', copySummary);
    $('#btn-export-summary').addEventListener('click', exportSummary);

    $('#summary-editor').addEventListener('input', () => {
      updateSummarySaveStatus();
      if (summaryMdView === 'preview') updateSummaryPreview();
    });

    document.addEventListener('keydown', (e) => {
      if (isQuickEntryShortcut(e)) {
        if (!canOpenQuickEntry()) return;
        e.preventDefault();
        openEntryDialog();
        return;
      }
      if (currentView !== 'summary') return;
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveSummary(true);
      }
    });

    $('#cal-prev').addEventListener('click', () => {
      calMonth--;
      if (calMonth < 0) {
        calMonth = 11;
        calYear--;
      }
      renderCalendar();
    });
    $('#cal-next').addEventListener('click', () => {
      calMonth++;
      if (calMonth > 11) {
        calMonth = 0;
        calYear++;
      }
      renderCalendar();
    });
    $('#cal-today').addEventListener('click', () => {
      const now = new Date();
      calYear = now.getFullYear();
      calMonth = now.getMonth();
      calSelectedDate = DateUtils.toDateKey(now);
      renderCalendar();
    });

    $('#schedule-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await addSchedule();
    });

    $('#meeting-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveMeeting();
    });
    $('#mm-cancel-edit').addEventListener('click', resetMeetingForm);

    $('#kp-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveKeyProject();
    });
    $('#kp-cancel-edit').addEventListener('click', resetKeyProjectForm);

    $('#sch-recurrence').addEventListener('change', updateScheduleFormVisibility);
    $('#sch-cancel-edit').addEventListener('click', resetScheduleForm);

    $('#password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await changePasswordHandler();
    });

    $('#btn-export-backup').addEventListener('click', exportBackupHandler);
    $('#import-backup').addEventListener('change', importBackupHandler);
    $('#btn-wipe').addEventListener('click', wipeHandler);

    $('#password-prompt-form').addEventListener('submit', (e) => {
      e.preventDefault();
      finishPasswordPrompt($('#password-prompt-input').value);
    });
    $('#password-prompt-cancel').addEventListener('click', () => finishPasswordPrompt(null));
    $('#password-prompt-dialog').addEventListener('cancel', (e) => {
      e.preventDefault();
      finishPasswordPrompt(null);
    });

    $('#edit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveEditLog();
    });
    $('#edit-cancel').addEventListener('click', () => $('#edit-dialog').close());
  }

  function getSummaryStorageKey() {
    return summaryMode === 'daily' ? `daily:${getSummaryDateKey()}` : `weekly:${getWeekId()}`;
  }

  function writeSummaryByKey(key, text) {
    const sep = key.indexOf(':');
    if (sep < 0) return;
    const type = key.slice(0, sep);
    const id = key.slice(sep + 1);
    if (type === 'daily') data.dailySummaries[id] = text;
    else if (type === 'weekly') data.weeklySummaries[id] = text;
  }

  function writeSummaryToData(text) {
    writeSummaryByKey(getSummaryStorageKey(), text);
  }

  function isSummaryDirty() {
    return $('#summary-editor').value !== summarySavedText;
  }

  function updateSummarySaveStatus(savedFlash) {
    const el = $('#summary-save-status');
    if (!el) return;
    if (savedFlash) {
      el.textContent = '已保存';
      el.className = 'summary-save-status saved';
      return;
    }
    if (isSummaryDirty()) {
      el.textContent = '未保存';
      el.className = 'summary-save-status dirty';
    } else {
      el.textContent = '已保存';
      el.className = 'summary-save-status saved';
    }
  }

  async function saveSummary(showFeedback) {
    const text = $('#summary-editor').value;
    writeSummaryToData(text);
    await persist();
    summarySavedText = text;
    summaryEditorKey = getSummaryStorageKey();
    updateSummaryPreview();
    updateSummarySaveStatus(!!showFeedback);
    if (showFeedback) {
      setTimeout(() => updateSummarySaveStatus(false), 2000);
    }
  }

  async function flushSummaryToStorage() {
    if (!data || !summaryEditorKey) return;
    if (!isSummaryDirty()) return;
    writeSummaryByKey(summaryEditorKey, $('#summary-editor').value);
    await persist();
    summarySavedText = $('#summary-editor').value;
  }

  function setSummaryMdView(mode) {
    summaryMdView = mode;
    $$('.tab[data-md-view]').forEach((t) => {
      t.classList.toggle('active', t.dataset.mdView === mode);
    });
    $('#summary-edit-hint').classList.toggle('hidden', mode !== 'source');
    if (mode === 'preview') {
      updateSummaryPreview();
      $('#summary-preview').classList.remove('hidden');
      $('#summary-editor').classList.add('hidden');
    } else {
      $('#summary-preview').classList.add('hidden');
      $('#summary-editor').classList.remove('hidden');
      $('#summary-editor').focus();
    }
  }

  function updateSummaryPreview() {
    const md = $('#summary-editor').value;
    $('#summary-preview').innerHTML = MarkdownRender.render(md);
  }

  function applySummaryText(text) {
    $('#summary-editor').value = text;
    summarySavedText = text;
    summaryEditorKey = getSummaryStorageKey();
    updateSummaryPreview();
    updateSummarySaveStatus(false);
  }

  async function handleLockSubmit() {
    const submitBtn = $('#lock-submit');
    const pwd = $('#lock-password').value;
    $('#lock-error').classList.add('hidden');

    if (!CryptoVault.isInitialized()) {
      showLockError('暂无本地数据，请先导入加密备份');
      return;
    }

    if (!window.isSecureContext || !window.crypto?.subtle) {
      showLockError('请通过 http://localhost:8080 访问（运行 start-server.bat）');
      return;
    }

    submitBtn.disabled = true;
    const prevLabel = submitBtn.textContent;
    submitBtn.textContent = '正在解锁…';

    try {
      await unlock(pwd);
    } catch (err) {
      showLockError(err.message || '解锁失败，请检查密码或改用 localhost 访问');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = prevLabel;
    }
  }

  async function handleLockImport(file) {
    if (!file) return;
    const pwd = $('#lock-import-password').value;
    $('#lock-error').classList.add('hidden');

    if (!window.isSecureContext || !window.crypto?.subtle) {
      showLockError('请通过 http://localhost:8080 访问（运行 start-server.bat）');
      return;
    }
    if (!pwd) {
      showLockError('请输入备份文件的主密码');
      return;
    }

    const btn = $('#lock-import-btn');
    btn.disabled = true;
    const prevLabel = btn.textContent;
    btn.textContent = '正在导入…';

    try {
      const text = await file.text();
      await CryptoVault.importBackup(pwd, text);
      await enterAppAfterImport(pwd);
    } catch {
      showLockError('导入失败：密码错误或文件无效');
    } finally {
      btn.disabled = false;
      btn.textContent = prevLabel;
      $('#lock-import-backup').value = '';
    }
  }

  function showLockError(msg) {
    const el = $('#lock-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function switchView(view) {
    currentView = view;
    $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === view));
    $$('.view').forEach((v) => v.classList.add('hidden'));
    $(`#view-${view}`).classList.remove('hidden');
    if (view === 'calendar') renderCalendar();
    if (view === 'schedules' || view === 'settings') renderScheduleList();
    if (view === 'meetings') renderMeetingList();
    if (view === 'key-projects') renderKeyProjects();
    if (view === 'settings') {
      renderProjectTagList();
      refreshProjectSelects();
    }
    if (view === 'summary') {
      renderSummary();
      setSummaryMdView(summaryMdView);
    }
    if (view === 'timeline') {
      renderTimeline();
      requestAnimationFrame(() => scrollTimelineToToday(false));
    }
  }

  function renderAll() {
    renderTimeline();
    renderSummary();
    renderScheduleList();
    renderMeetingList();
    renderKeyProjects();
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDeadlineLabel(deadline) {
    if (!deadline) return '';
    const d = DateUtils.parseDateKey(deadline);
    return `DDL ${d.getMonth() + 1}/${d.getDate()}`;
  }

  function isDeadlineOverdue(deadline, logType) {
    if (!deadline || logType === 'done') return false;
    return deadline < DateUtils.toDateKey(new Date());
  }

  function deadlineMetaHtml(log) {
    if (!log.deadline) return '';
    const overdue = isDeadlineOverdue(log.deadline, log.type);
    return `<span class="log-deadline${overdue ? ' overdue' : ''}">· ${escapeHtml(formatDeadlineLabel(log.deadline))}${overdue ? ' 已逾期' : ''}</span>`;
  }

  async function addLog() {
    const content = $('#entry-content').value.trim();
    if (!content) return;

    const timeVal = $('#entry-time').value;
    const ts = timeVal ? new Date(timeVal).getTime() : Date.now();
    const date = DateUtils.toDateKey(new Date(ts));

    data.logs.unshift({
      id: uid(),
      content,
      type: $('#entry-type').value,
      purpose: $('#entry-purpose').value.trim(),
      notes: $('#entry-notes').value.trim(),
      withWhom: $('#entry-with-whom').value.trim(),
      project: $('#entry-project').value,
      deadline: $('#entry-deadline').value || '',
      tags: readEntryTags(),
      keyProjectIds: readKeyProjectPicker($('#entry-key-projects')),
      timestamp: ts,
      date,
    });

    await persist();
    resetEntryForm();
    $('#entry-dialog').close();
    renderTimeline();
    scrollTimelineToToday(false);
    if (currentView === 'calendar') renderCalendar();
    if (currentView === 'schedules') renderScheduleList();
    if (currentView === 'key-projects') renderKeyProjects();
  }

  function scrollTimelineToToday(smooth = true) {
    const today = DateUtils.toDateKey(new Date());
    const el = document.getElementById(`timeline-day-${today}`);
    const target = el || $('#timeline-axis')?.firstElementChild;
    if (!target) return;
    target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  }

  function renderDayStatsHtml(stats) {
    return `
      <span class="timeline-day-stat stat-done">已完成 ${stats.done}</span>
      <span class="timeline-day-stat stat-doing">进行中 ${stats.doing}</span>
      <span class="timeline-day-stat stat-plan">计划 ${stats.plan}</span>
    `;
  }

  function getTimelineTagFilter() {
    const mode = data?.settings?.trivialFilterMode || 'all';
    if (mode === 'only') return TRIVIAL_TAG;
    if (mode === 'exclude') return 'exclude-trivial';
    return '';
  }

  function setTimelineTrivialFilter(mode) {
    if (!data.settings) data.settings = DEFAULT_DATA().settings;
    data.settings.trivialFilterMode = mode;
    updateTrivialFilterSwitch();
  }

  function updateTrivialFilterSwitch() {
    const btn = $('#filter-trivial');
    if (!btn) return;
    const mode = data?.settings?.trivialFilterMode || 'all';
    const aria = { all: '全部', only: '仅琐碎', exclude: '非琐碎' };
    btn.dataset.mode = mode;
    btn.setAttribute('aria-label', `琐碎任务筛选：${aria[mode] || aria.all}`);
    btn.setAttribute('aria-pressed', mode === 'only' ? 'true' : 'false');
  }

  async function cycleTimelineTrivialFilter() {
    const order = ['all', 'only', 'exclude'];
    const current = data?.settings?.trivialFilterMode || 'all';
    const next = order[(order.indexOf(current) + 1) % order.length];
    setTimelineTrivialFilter(next);
    await persist();
    renderTimeline();
  }

  function getTimelineFilterContext() {
    const typeFilter = $('#filter-type').value;
    const tagFilter = getTimelineTagFilter();
    const projectFilter = $('#filter-project').value;
    const showSchedules = !projectFilter && tagFilter !== TRIVIAL_TAG;
    return { typeFilter, tagFilter, projectFilter, showSchedules };
  }

  function isScheduleCompleted(scheduleId, dateKey) {
    return data.scheduleCompletions.some(
      (c) => c.scheduleId === scheduleId && c.date === dateKey && c.completed
    );
  }

  /** 固定日程：打勾=已完成，未打勾=计划；不属于任何项目；非琐碎任务 */
  function filterSchedulesForTimeline(dateKey, ctx) {
    if (!ctx.showSchedules || ctx.typeFilter === 'doing') return [];
    let schedules = ScheduleLogic.getSchedulesForDate(data.schedules, dateKey);
    if (ctx.typeFilter === 'done') {
      schedules = schedules.filter((s) => isScheduleCompleted(s.id, dateKey));
    } else if (ctx.typeFilter === 'plan') {
      schedules = schedules.filter((s) => !isScheduleCompleted(s.id, dateKey));
    }
    return schedules;
  }

  function extendTimelineSpanFromSchedules(start, end) {
    data.schedules.forEach((sch) => {
      if (sch.startWeekId) {
        const mon = DateUtils.weekStartFromWeekId(sch.startWeekId);
        if (mon && mon < start) start = mon;
      }
      if (sch.endWeekId) {
        const endMon = DateUtils.weekStartFromWeekId(sch.endWeekId);
        if (endMon) {
          const weekEnd = DateUtils.endOfWeek(endMon);
          if (weekEnd > end) end = weekEnd;
        }
      }
    });
    return { start, end };
  }

  function getTimelineSpan(logs, ctx) {
    const today = DateUtils.parseDateKey(DateUtils.toDateKey(new Date()));
    let start = today;
    let end = today;
    if (logs.length) {
      start = DateUtils.parseDateKey([...new Set(logs.map((l) => l.date))].sort()[0]);
    }
    const includeSchedules = ctx.showSchedules && ctx.typeFilter !== 'doing';
    if (includeSchedules && data.schedules.length) {
      ({ start, end } = extendTimelineSpanFromSchedules(start, end));
      if (!logs.length && start > today) start = today;
    }
    return { start, end };
  }

  function countScheduleStatsInSpan(start, end, ctx) {
    let done = 0;
    let plan = 0;
    if (!ctx.showSchedules || ctx.typeFilter === 'doing') return { done, plan };
    for (let cursor = new Date(start); cursor <= end; cursor = DateUtils.addDays(cursor, 1)) {
      const dk = DateUtils.toDateKey(cursor);
      filterSchedulesForTimeline(dk, ctx).forEach((s) => {
        if (isScheduleCompleted(s.id, dk)) done += 1;
        else plan += 1;
      });
    }
    return { done, plan };
  }

  function collectTimelineDates(logs, ctx) {
    const keys = new Set(logs.map((l) => l.date));
    const includeSchedules = ctx.showSchedules && ctx.typeFilter !== 'doing';
    const { start, end } = getTimelineSpan(logs, ctx);

    if (!keys.size && !includeSchedules) return [];
    if (!keys.size && includeSchedules && !data.schedules.length) return [];

    if (includeSchedules) {
      for (let cursor = end; cursor >= start; cursor = DateUtils.addDays(cursor, -1)) {
        const dk = DateUtils.toDateKey(cursor);
        if (keys.has(dk)) continue;
        if (filterSchedulesForTimeline(dk, ctx).length) {
          keys.add(dk);
        }
      }
    }

    return [...keys].sort((a, b) => b.localeCompare(a));
  }

  function readScheduleWeekRange() {
    const startWeekId = $('#sch-start-week').value || '';
    const endWeekId = $('#sch-end-week').value || '';
    if (startWeekId && endWeekId && endWeekId < startWeekId) {
      return { error: '结束周不能早于开始周' };
    }
    const range = DateUtils.weekRangeFromIds(startWeekId, endWeekId);
    return { startWeekId, endWeekId, startDate: range.startDate, endDate: range.endDate };
  }

  function setScheduleWeekDefaults() {
    const cur = DateUtils.currentWeekId();
    if ($('#sch-start-week')) $('#sch-start-week').value = cur;
    if ($('#sch-end-week')) $('#sch-end-week').value = '';
  }

  function ensureScheduleWeekIds() {
    if (!data?.schedules?.length) return false;
    let changed = false;
    data.schedules.forEach((s) => {
      if (!s.startWeekId && s.startDate) {
        s.startWeekId = DateUtils.getISOWeekInfo(DateUtils.parseDateKey(s.startDate)).weekId;
        changed = true;
      }
      if (!s.endWeekId && s.endDate) {
        s.endWeekId = DateUtils.getISOWeekInfo(DateUtils.parseDateKey(s.endDate)).weekId;
        changed = true;
      }
      if ((s.startWeekId || s.endWeekId) && (!s.startDate || !s.endDate)) {
        const range = DateUtils.weekRangeFromIds(s.startWeekId || '', s.endWeekId || '');
        if (range.startDate && s.startDate !== range.startDate) {
          s.startDate = range.startDate;
          changed = true;
        }
        if (range.endDate && s.endDate !== range.endDate) {
          s.endDate = range.endDate;
          changed = true;
        }
      }
    });
    return changed;
  }

  function scheduleWeekRangeLabel(s) {
    if (!s.startWeekId && !s.endWeekId) return '';
    if (s.startWeekId && s.endWeekId) return `${s.startWeekId} ~ ${s.endWeekId}`;
    if (s.startWeekId) return `${s.startWeekId} 起`;
    return `至 ${s.endWeekId}`;
  }

  function appendTimelineSchedules(body, dateKey, schedules) {
    if (!schedules.length) return;

    const block = document.createElement('div');
    block.className = 'timeline-schedules';
    block.innerHTML = '<h4 class="timeline-schedules-title">固定日程</h4>';

    schedules.forEach((s) => {
      const done = isScheduleCompleted(s.id, dateKey);
      const item = document.createElement('div');
      item.className = 'timeline-schedule-item cal-schedule-item';
      item.style.setProperty('--schedule-color', s.color || SCHEDULE_COLORS[0]);
      item.innerHTML = `
        <label class="checkbox-label">
          <input type="checkbox" data-sid="${s.id}" ${done ? 'checked' : ''} />
          ${escapeHtml(s.title)}
        </label>
        ${s.purpose ? `<span class="cal-schedule-purpose">目的：${escapeHtml(s.purpose)}</span>` : ''}
        ${s.notes ? `<span class="cal-schedule-notes">备注：${escapeHtml(s.notes)}</span>` : ''}
      `;
      block.appendChild(item);
    });

    body.appendChild(block);

    block.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.addEventListener('change', async () => {
        await toggleScheduleComplete(cb.dataset.sid, dateKey, cb.checked);
        if (currentView === 'timeline') renderTimeline();
      });
    });
  }

  function applyTimelineLogFilters(logs, ctx, { includeTypeFilter = true } = {}) {
    let filtered = logs;
    if (includeTypeFilter && ctx.typeFilter) {
      filtered = filtered.filter((l) => l.type === ctx.typeFilter);
    }
    if (ctx.projectFilter) filtered = filtered.filter((l) => l.project === ctx.projectFilter);
    if (ctx.tagFilter === TRIVIAL_TAG) filtered = filtered.filter((l) => isTrivialLog(l));
    if (ctx.tagFilter === 'exclude-trivial') filtered = filtered.filter((l) => !isTrivialLog(l));
    return filtered;
  }

  function computeTimelineHeaderStats(scopeLogs, ctx) {
    const statsCtx = { ...ctx, typeFilter: '' };
    const { start, end } = getTimelineSpan(scopeLogs, statsCtx);
    const scheduleStats = countScheduleStatsInSpan(start, end, statsCtx);
    return {
      done: scopeLogs.filter((l) => l.type === 'done').length + scheduleStats.done,
      doing: scopeLogs.filter((l) => l.type === 'doing').length,
      plan: scopeLogs.filter((l) => l.type === 'plan').length + scheduleStats.plan,
    };
  }

  function renderTimeline() {
    const ctx = getTimelineFilterContext();
    const { typeFilter } = ctx;
    const scopeLogs = applyTimelineLogFilters([...data.logs], ctx, { includeTypeFilter: false });
    const headerStats = computeTimelineHeaderStats(scopeLogs, ctx);
    let logs = applyTimelineLogFilters([...data.logs], ctx);

    const statChip = (type, label, count) => {
      const active = typeFilter === type ? ' stat-filter--active' : '';
      return `<button type="button" class="stat-item stat-filter stat-${type}${active}" data-filter-type="${type}">${label} ${count}</button>`;
    };
    $('#timeline-stats').innerHTML =
      statChip('done', '已完成', headerStats.done) +
      statChip('doing', '进行中', headerStats.doing) +
      statChip('plan', '计划', headerStats.plan);

    const byDate = new Map();
    for (const log of logs) {
      if (!byDate.has(log.date)) byDate.set(log.date, []);
      byDate.get(log.date).push(log);
    }

    const dates = collectTimelineDates(logs, ctx);
    const axis = $('#timeline-axis');
    axis.className = `timeline-axis timeline-axis--${getTimelineView()}`;
    axis.innerHTML = '';
    updateTimelineViewToggle();
    updateTrivialFilterSwitch();
    $('#timeline-empty').classList.toggle('hidden', dates.length > 0);

    const today = DateUtils.toDateKey(new Date());

    dates.forEach((dateKey) => {
      const dayLogs = byDate.get(dateKey) || [];
      dayLogs.sort((a, b) => b.timestamp - a.timestamp);

      const daySchedules = filterSchedulesForTimeline(dateKey, ctx);
      const dayStats = {
        done:
          dayLogs.filter((l) => l.type === 'done').length +
          daySchedules.filter((s) => isScheduleCompleted(s.id, dateKey)).length,
        doing: dayLogs.filter((l) => l.type === 'doing').length,
        plan:
          dayLogs.filter((l) => l.type === 'plan').length +
          daySchedules.filter((s) => !isScheduleCompleted(s.id, dateKey)).length,
      };

      const section = document.createElement('section');
      section.className = `timeline-day${dateKey === today ? ' today' : ''}`;
      section.id = `timeline-day-${dateKey}`;

      const aside = document.createElement('div');
      aside.className = 'timeline-day-aside';
      aside.innerHTML = `
        <span class="timeline-day-dot" aria-hidden="true"></span>
        <div class="timeline-day-marker">
          <h3 class="timeline-day-title">${DateUtils.formatCN(DateUtils.parseDateKey(dateKey))}</h3>
          <div class="timeline-day-stats">${renderDayStatsHtml(dayStats)}</div>
        </div>
      `;

      const body = document.createElement('div');
      body.className = 'timeline-day-body';
      if (daySchedules.length) appendTimelineSchedules(body, dateKey, daySchedules);

      if (dayLogs.length) {
        const list = document.createElement('ul');
        list.className = 'log-list';
        dayLogs.forEach((log) => list.appendChild(createLogItem(log)));
        body.appendChild(list);
      } else if (!daySchedules.length) {
        const empty = document.createElement('p');
        empty.className = 'timeline-day-empty hint';
        empty.textContent = '当日无记录';
        body.appendChild(empty);
      }

      section.appendChild(aside);
      section.appendChild(body);
      axis.appendChild(section);
    });
  }

  function logTagsHtml(log) {
    const chips = [];
    if (log.project) {
      chips.push(`<span class="log-tag log-tag--project-label">${escapeHtml(log.project)}</span>`);
    }
    (log.tags || []).forEach((t) => {
      chips.push(
        `<span class="log-tag log-tag--${t === TRIVIAL_TAG ? 'trivial' : 'default'}">${escapeHtml(t)}</span>`
      );
    });
    (log.keyProjectIds || []).forEach((id) => {
      const name = getKeyProjectById(id)?.name;
      if (name) chips.push(`<span class="log-tag log-tag--key-project">${escapeHtml(name)}</span>`);
    });
    if (!chips.length) return '';
    return `<div class="log-tags">${chips.join('')}</div>`;
  }

  function logActionsHtml() {
    return `
      <div class="log-actions">
        <button type="button" class="btn-secondary btn-edit">编辑</button>
        <button type="button" class="btn-danger btn-delete">删除</button>
      </div>
    `;
  }

  function logDetailedMainHtml(log) {
    const typeClass = `type-${log.type}`;
    const typeLabel = SummaryEngine.TYPE_LABELS[log.type];
    return `
      <div class="log-meta">
        <span class="type-badge ${typeClass}">${typeLabel}</span>
        <span>${DateUtils.formatTime(log.timestamp)}</span>
        ${log.withWhom ? `<span>· 与 ${escapeHtml(log.withWhom)}</span>` : ''}
        ${deadlineMetaHtml(log)}
      </div>
      ${logTagsHtml(log)}
      <p class="log-content">${escapeHtml(log.content)}</p>
      ${log.purpose ? `<p class="log-purpose">目的：${escapeHtml(log.purpose)}</p>` : ''}
      ${log.notes ? `<p class="log-notes">备注：${escapeHtml(log.notes)}</p>` : ''}
    `;
  }

  function logCompactTagsInlineHtml(log) {
    const chips = [];
    if (log.project) {
      chips.push(`<span class="log-tag log-tag--project-label">${escapeHtml(log.project)}</span>`);
    }
    (log.tags || []).forEach((t) => {
      chips.push(
        `<span class="log-tag log-tag--${t === TRIVIAL_TAG ? 'trivial' : 'default'}">${escapeHtml(t)}</span>`
      );
    });
    (log.keyProjectIds || []).forEach((id) => {
      const name = getKeyProjectById(id)?.name;
      if (name) chips.push(`<span class="log-tag log-tag--key-project">${escapeHtml(name)}</span>`);
    });
    if (!chips.length) return '';
    return `<span class="log-compact-tags">${chips.join('')}</span>`;
  }

  function logCompactMainHtml(log) {
    const typeClass = `type-${log.type}`;
    const typeLabel = SummaryEngine.TYPE_LABELS[log.type];
    const metaBits = [
      `<span class="type-badge ${typeClass}">${typeLabel}</span>`,
      `<span>${DateUtils.formatTime(log.timestamp)}</span>`,
    ];
    if (log.withWhom) metaBits.push(`<span>与 ${escapeHtml(log.withWhom)}</span>`);
    if (log.deadline) {
      const overdue = isDeadlineOverdue(log.deadline, log.type);
      metaBits.push(
        `<span class="log-deadline${overdue ? ' overdue' : ''}">${escapeHtml(formatDeadlineLabel(log.deadline))}${overdue ? ' 已逾期' : ''}</span>`
      );
    }
    const summary = [
      log.content,
      log.purpose ? `目的：${log.purpose}` : '',
      log.notes ? `备注：${log.notes}` : '',
    ]
      .filter(Boolean)
      .join(' · ');

    return `
      <div class="log-compact-line log-compact-meta">
        <div class="log-compact-meta-start">${metaBits.join('')}</div>
        ${logCompactTagsInlineHtml(log)}
      </div>
      <p class="log-compact-line log-compact-summary" title="${escapeHtml(summary)}">${escapeHtml(summary)}</p>
    `;
  }

  function createLogItem(log) {
    const view = getTimelineView();
    const li = document.createElement('li');
    li.className = `log-item log-item--${view}`;
    const mainHtml = view === 'compact' ? logCompactMainHtml(log) : logDetailedMainHtml(log);
    li.innerHTML = `<div class="log-item-main">${mainHtml}</div>${logActionsHtml()}`;
    li.querySelector('.btn-edit').addEventListener('click', () => openEditDialog(log));
    li.querySelector('.btn-delete').addEventListener('click', () => deleteLog(log.id));
    return li;
  }

  function openEditDialog(log) {
    editingLogId = log.id;
    $('#edit-content').value = log.content;
    $('#edit-type').value = log.type;
    $('#edit-with-whom').value = log.withWhom || '';
    fillProjectSelect($('#edit-project'), { emptyLabel: '无', selected: log.project || '' });
    $('#edit-purpose').value = log.purpose || '';
    $('#edit-notes').value = log.notes || '';
    $('#edit-deadline').value = log.deadline || '';
    $('#edit-tag-trivial').checked = isTrivialLog(log);
    renderKeyProjectPicker($('#edit-key-projects'), log.keyProjectIds || []);
    const dt = new Date(log.timestamp);
    dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
    $('#edit-time').value = dt.toISOString().slice(0, 16);
    $('#edit-dialog').showModal();
  }

  async function saveEditLog() {
    const log = data.logs.find((l) => l.id === editingLogId);
    if (!log) return;
    const ts = new Date($('#edit-time').value).getTime();
    log.content = $('#edit-content').value.trim();
    log.type = $('#edit-type').value;
    log.withWhom = $('#edit-with-whom').value.trim();
    log.project = $('#edit-project').value;
    log.purpose = $('#edit-purpose').value.trim();
    log.notes = $('#edit-notes').value.trim();
    log.deadline = $('#edit-deadline').value || '';
    log.tags = readEditTags();
    log.keyProjectIds = readKeyProjectPicker($('#edit-key-projects'));
    log.timestamp = ts;
    log.date = DateUtils.toDateKey(new Date(ts));
    await persist();
    $('#edit-dialog').close();
    renderTimeline();
    if (currentView === 'key-projects') renderKeyProjects();
  }

  async function deleteLog(id) {
    if (!confirm('确定删除这条记录？')) return;
    data.logs = data.logs.filter((l) => l.id !== id);
    await persist();
    renderTimeline();
  }

  function getSummaryDateKey() {
    return $('#summary-date').value || DateUtils.toDateKey(new Date());
  }

  function getWeekId() {
    const d = DateUtils.parseDateKey(getSummaryDateKey());
    return DateUtils.getISOWeekInfo(DateUtils.startOfWeek(d)).weekId;
  }

  function shiftSummaryDate(delta) {
    const d = DateUtils.parseDateKey(getSummaryDateKey());
    $('#summary-date').value = DateUtils.toDateKey(DateUtils.addDays(d, delta));
    renderSummary();
  }

  function renderSummary() {
    const dateKey = getSummaryDateKey();
    let text;

    if (summaryMode === 'daily') {
      if (data.dailySummaries[dateKey]) {
        text = data.dailySummaries[dateKey];
      } else {
        text = SummaryEngine.generateDaily(
          dateKey,
          data.logs,
          data.schedules,
          data.scheduleCompletions
        );
      }
    } else {
      const weekId = getWeekId();
      if (data.weeklySummaries[weekId]) {
        text = data.weeklySummaries[weekId];
      } else {
        const weekStart = DateUtils.startOfWeek(DateUtils.parseDateKey(dateKey));
        text = SummaryEngine.generateWeekly(
          weekStart,
          data.logs,
          data.schedules,
          data.scheduleCompletions
        );
      }
    }
    applySummaryText(text);
    setSummaryMdView(summaryMdView);
  }

  async function copySummary() {
    await navigator.clipboard.writeText($('#summary-editor').value);
    alert('已复制到剪贴板');
  }

  function exportSummary() {
    const text = $('#summary-editor').value;
    const name =
      summaryMode === 'daily'
        ? `日报-${getSummaryDateKey()}.md`
        : `周报-${getWeekId()}.md`;
    downloadFile(name, text, 'text/markdown');
  }

  function renderCalendar() {
    $('#cal-title').textContent = `${calYear}年${calMonth + 1}月`;
    const grid = $('#cal-grid');
    grid.innerHTML = '';
    const matrix = DateUtils.monthMatrix(calYear, calMonth);

    matrix.flat().forEach((date) => {
      const cell = document.createElement('div');
      const dateKey = DateUtils.toDateKey(date);
      const isOther = date.getMonth() !== calMonth;
      cell.className =
        'cal-cell' +
        (isOther ? ' other-month' : '') +
        (DateUtils.isToday(date) ? ' today' : '') +
        (dateKey === calSelectedDate ? ' selected' : '');

      const schedules = ScheduleLogic.getSchedulesForDate(data.schedules, dateKey);
      const dotsHtml = schedules
        .map(
          (s) =>
            `<span class="cal-dot" style="background:${escapeHtml(s.color || SCHEDULE_COLORS[0])}" title="${escapeHtml(s.title)}"></span>`
        )
        .join('');
      cell.innerHTML = `
        <div class="cal-day-num">${date.getDate()}</div>
        <div class="cal-dots">${dotsHtml}</div>
      `;
      cell.addEventListener('click', () => {
        calSelectedDate = dateKey;
        renderCalendar();
        renderCalDetail(dateKey);
      });
      grid.appendChild(cell);
    });

    renderCalDetail(calSelectedDate);
    renderCalendarLegend();
  }

  function renderCalendarLegend() {
    const el = $('#cal-legend');
    if (!data.schedules.length) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = data.schedules
      .map(
        (s) =>
          `<span class="cal-legend-item"><span class="cal-legend-dot" style="background:${escapeHtml(s.color || SCHEDULE_COLORS[0])}"></span>${escapeHtml(s.title)}</span>`
      )
      .join('');
  }

  function renderCalDetail(dateKey) {
    const d = DateUtils.parseDateKey(dateKey);
    $('#cal-detail-date').textContent = DateUtils.formatCN(d);

    const schedules = ScheduleLogic.getSchedulesForDate(data.schedules, dateKey);
    const schEl = $('#cal-schedules');
    if (!schedules.length) {
      schEl.innerHTML = '<p class="hint">当日无固定日程</p>';
    } else {
      schEl.innerHTML =
        '<h4>固定日程</h4>' +
        schedules
          .map((s) => {
            const done = data.scheduleCompletions.some(
              (c) => c.scheduleId === s.id && c.date === dateKey && c.completed
            );
            const purpose = s.purpose
              ? `<span class="cal-schedule-purpose">目的：${escapeHtml(s.purpose)}</span>`
              : '';
            const notes = s.notes
              ? `<span class="cal-schedule-notes">备注：${escapeHtml(s.notes)}</span>`
              : '';
            return `<div class="cal-schedule-item" style="--schedule-color:${escapeHtml(s.color || SCHEDULE_COLORS[0])}">
              <label class="checkbox-label">
              <input type="checkbox" data-sid="${s.id}" ${done ? 'checked' : ''} />
              ${escapeHtml(s.title)}
            </label>${purpose}${notes}</div>`;
          })
          .join('');

      schEl.querySelectorAll('input[type=checkbox]').forEach((cb) => {
        cb.addEventListener('change', async () => {
          await toggleScheduleComplete(cb.dataset.sid, dateKey, cb.checked);
        });
      });
    }

    const dayLogs = data.logs.filter((l) => l.date === dateKey);
    const logEl = $('#cal-day-logs');
    if (!dayLogs.length) {
      logEl.innerHTML = '<h4>当日日志</h4><p class="hint">无记录</p>';
    } else {
      logEl.innerHTML =
        '<h4>当日日志</h4>' +
        dayLogs
          .slice(0, 8)
          .map(
            (l) =>
              `<div style="font-size:12px;margin-bottom:6px"><span class="type-badge type-${l.type}">${SummaryEngine.TYPE_LABELS[l.type]}</span> ${escapeHtml(l.content.slice(0, 60))}${l.content.length > 60 ? '…' : ''}</div>`
          )
          .join('');
    }
  }

  async function toggleScheduleComplete(scheduleId, dateKey, completed) {
    data.scheduleCompletions = data.scheduleCompletions.filter(
      (c) => !(c.scheduleId === scheduleId && c.date === dateKey)
    );
    if (completed) {
      data.scheduleCompletions.push({ scheduleId, date: dateKey, completed: true });
    }
    await persist();
  }

  function recurrenceLabel(s) {
    let label = '';
    if (s.recurrenceType === 'daily') label = '每天';
    else if (s.recurrenceType === 'weekly' || s.recurrenceType === 'biweekly') {
      const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const prefix = s.recurrenceType === 'biweekly' ? '每双周' : '每周';
      label = `${prefix}${names[s.dayOfWeek ?? 3]}`;
    } else label = `每月 ${s.dayOfMonth ?? 1} 日`;
    const weekPart = scheduleWeekRangeLabel(s);
    return weekPart ? `${label} · ${weekPart}` : label;
  }

  async function addSchedule() {
    const title = $('#sch-title').value.trim();
    if (!title) return;
    const weekRange = readScheduleWeekRange();
    if (weekRange.error) {
      alert(weekRange.error);
      return;
    }
    const type = $('#sch-recurrence').value;
    const editId = $('#sch-edit-id').value;
    const payload = {
      title,
      purpose: $('#sch-purpose').value.trim(),
      notes: $('#sch-notes').value.trim(),
      recurrenceType: type,
      reminder: $('#sch-reminder').checked,
      color: $('#sch-color').value || nextScheduleColor(),
      keyProjectIds: readKeyProjectPicker($('#sch-key-projects')),
      startWeekId: weekRange.startWeekId,
      endWeekId: weekRange.endWeekId,
      startDate: weekRange.startDate,
      endDate: weekRange.endDate,
    };
    if (type === 'weekly' || type === 'biweekly') payload.dayOfWeek = parseInt($('#sch-dow').value, 10);
    if (type === 'monthly') payload.dayOfMonth = parseInt($('#sch-dom').value, 10);

    if (editId) {
      const s = data.schedules.find((x) => x.id === editId);
      if (s) Object.assign(s, payload);
    } else {
      data.schedules.push({ id: uid(), ...payload });
    }

    await persist();
    resetScheduleForm();
    renderScheduleList();
    if (currentView === 'calendar') renderCalendar();
    if (currentView === 'schedules') renderScheduleList();
    if (currentView === 'timeline') renderTimeline();
    if (currentView === 'key-projects') renderKeyProjects();
  }

  function resetScheduleForm() {
    $('#sch-edit-id').value = '';
    $('#sch-title').value = '';
    $('#sch-purpose').value = '';
    $('#sch-notes').value = '';
    $('#sch-recurrence').value = 'weekly';
    $('#sch-dow').value = '3';
    $('#sch-dom').value = '1';
    $('#sch-reminder').checked = true;
    $('#sch-submit-btn').textContent = '添加';
    $('#sch-cancel-edit').classList.add('hidden');
    selectScheduleColor(nextScheduleColor());
    updateScheduleFormVisibility();
    renderKeyProjectPicker($('#sch-key-projects'), []);
    setScheduleWeekDefaults();
  }

  function editSchedule(s) {
    $('#sch-edit-id').value = s.id;
    $('#sch-title').value = s.title;
    $('#sch-purpose').value = s.purpose || '';
    $('#sch-notes').value = s.notes || '';
    selectScheduleColor(s.color || SCHEDULE_COLORS[0]);
    $('#sch-recurrence').value = s.recurrenceType || 'weekly';
    $('#sch-dow').value = String(s.dayOfWeek ?? 3);
    $('#sch-dom').value = String(s.dayOfMonth ?? 1);
    $('#sch-reminder').checked = s.reminder !== false;
    $('#sch-start-week').value = s.startWeekId || '';
    $('#sch-end-week').value = s.endWeekId || '';
    $('#sch-submit-btn').textContent = '保存修改';
    $('#sch-cancel-edit').classList.remove('hidden');
    updateScheduleFormVisibility();
    renderKeyProjectPicker($('#sch-key-projects'), s.keyProjectIds || []);
    switchView('schedules');
  }

  function renderScheduleList() {
    const list = $('#schedule-list');
    list.innerHTML = '';
    if (!data.schedules.length) {
      list.innerHTML = '<li class="hint">暂无固定日程</li>';
      return;
    }
    data.schedules.forEach((s) => {
      const li = document.createElement('li');
      const purposeHtml = s.purpose
        ? `<div class="schedule-item-purpose">目的：${escapeHtml(s.purpose)}</div>`
        : '';
      const notesHtml = s.notes
        ? `<div class="schedule-item-notes">备注：${escapeHtml(s.notes)}</div>`
        : '';
      li.innerHTML = `<div class="schedule-item-main"><div class="schedule-item-title"><span class="schedule-color-dot" style="background:${escapeHtml(s.color || SCHEDULE_COLORS[0])}"></span><span class="schedule-item-title-text">${escapeHtml(s.title)} · ${recurrenceLabel(s)}</span></div>${purposeHtml}${notesHtml}</div>`;
      const actions = document.createElement('span');
      actions.style.display = 'flex';
      actions.style.gap = '0.5rem';
      const editBtn = document.createElement('button');
      editBtn.className = 'btn-secondary';
      editBtn.textContent = '编辑';
      editBtn.addEventListener('click', () => editSchedule(s));
      const btn = document.createElement('button');
      btn.className = 'btn-secondary';
      btn.textContent = '删除';
      btn.addEventListener('click', () => deleteSchedule(s.id));
      actions.appendChild(editBtn);
      actions.appendChild(btn);
      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  function setMeetingFormTimeDefault() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    $('#mm-time').value = now.toISOString().slice(0, 16);
  }

  function resetMeetingForm() {
    $('#mm-edit-id').value = '';
    $('#mm-topic').value = '';
    $('#mm-location').value = '';
    $('#mm-participants').value = '';
    $('#mm-content').value = '';
    $('#mm-todos').value = '';
    $('#mm-submit-btn').textContent = '保存纪要';
    $('#mm-cancel-edit').classList.add('hidden');
    setMeetingFormTimeDefault();
  }

  function formatMeetingDateTime(ts) {
    const dt = new Date(ts);
    return `${DateUtils.formatCN(dt)} ${DateUtils.formatTime(ts)}`;
  }

  async function saveMeeting() {
    const topic = $('#mm-topic').value.trim();
    const content = $('#mm-content').value.trim();
    if (!topic || !content) return;

    const timeVal = $('#mm-time').value;
    const ts = timeVal ? new Date(timeVal).getTime() : Date.now();
    const payload = {
      topic,
      location: $('#mm-location').value.trim(),
      participants: $('#mm-participants').value.trim(),
      content,
      todos: $('#mm-todos').value.trim(),
      timestamp: ts,
      date: DateUtils.toDateKey(new Date(ts)),
    };

    const editId = $('#mm-edit-id').value;
    if (editId) {
      const meeting = data.meetings.find((m) => m.id === editId);
      if (meeting) Object.assign(meeting, payload);
    } else {
      data.meetings.unshift({ id: uid(), ...payload });
    }

    await persist();
    resetMeetingForm();
    renderMeetingList();
  }

  function editMeeting(meeting) {
    $('#mm-edit-id').value = meeting.id;
    $('#mm-topic').value = meeting.topic || '';
    $('#mm-location').value = meeting.location || '';
    $('#mm-participants').value = meeting.participants || '';
    $('#mm-content').value = meeting.content || '';
    $('#mm-todos').value = meeting.todos || '';
    const dt = new Date(meeting.timestamp);
    dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
    $('#mm-time').value = dt.toISOString().slice(0, 16);
    $('#mm-submit-btn').textContent = '保存修改';
    $('#mm-cancel-edit').classList.remove('hidden');
    switchView('meetings');
    $('#mm-topic').focus();
  }

  async function deleteMeeting(id) {
    if (!confirm('确定删除这条会议纪要？')) return;
    data.meetings = data.meetings.filter((m) => m.id !== id);
    expandedMeetingIds.delete(id);
    await persist();
    renderMeetingList();
  }

  function countMeetingTodos(todos) {
    if (!todos?.trim()) return 0;
    return todos
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean).length;
  }

  function toggleMeetingCard(card, meetingId) {
    if (expandedMeetingIds.has(meetingId)) {
      expandedMeetingIds.delete(meetingId);
      card.classList.remove('meeting-card--expanded');
      card.classList.add('meeting-card--collapsed');
    } else {
      expandedMeetingIds.add(meetingId);
      card.classList.add('meeting-card--expanded');
      card.classList.remove('meeting-card--collapsed');
    }
    const toggle = card.querySelector('.meeting-card-toggle');
    const isExpanded = expandedMeetingIds.has(meetingId);
    if (toggle) {
      toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
      toggle.setAttribute('aria-label', isExpanded ? '折叠纪要' : '展开纪要');
    }
  }

  function renderMeetingTodosHtml(todos) {
    if (!todos?.trim()) {
      return '<p class="meeting-todos-empty hint">（无 Todo）</p>';
    }
    const lines = todos
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      return '<p class="meeting-todos-empty hint">（无 Todo）</p>';
    }
    return `<div class="meeting-todos-text">${escapeHtml(lines.join('\n'))}</div>`;
  }

  function renderMeetingList() {
    const list = $('#meeting-list');
    const empty = $('#meeting-empty');
    if (!list) return;

    const meetings = [...(data.meetings || [])].sort((a, b) => b.timestamp - a.timestamp);
    list.innerHTML = '';
    empty?.classList.toggle('hidden', meetings.length > 0);

    meetings.forEach((meeting) => {
      const expanded = expandedMeetingIds.has(meeting.id);
      const metaParts = [formatMeetingDateTime(meeting.timestamp)];
      if (meeting.location) metaParts.push(escapeHtml(meeting.location));
      if (meeting.participants) metaParts.push(`参与人：${escapeHtml(meeting.participants)}`);

      const title = meeting.topic || meeting.content?.slice(0, 40) || '未命名会议';
      const todoCount = countMeetingTodos(meeting.todos);

      const card = document.createElement('article');
      card.className = `meeting-card ${expanded ? 'meeting-card--expanded' : 'meeting-card--collapsed'}`;
      card.innerHTML = `
        <header class="meeting-card-header">
          <button type="button" class="meeting-card-toggle" aria-expanded="${expanded ? 'true' : 'false'}" aria-label="${expanded ? '折叠纪要' : '展开纪要'}">
            <div class="meeting-card-heading">
              <h3 class="meeting-card-title">${escapeHtml(title)}</h3>
              <div class="meeting-card-meta">${metaParts.join(' · ')}</div>
            </div>
            <span class="meeting-card-chevron" aria-hidden="true">›</span>
          </button>
          <div class="meeting-card-actions">
            <button type="button" class="btn-secondary btn-edit">编辑</button>
            <button type="button" class="btn-secondary btn-delete">删除</button>
          </div>
        </header>
        ${
          todoCount
            ? `<div class="meeting-card-stats"><span>Todo ${todoCount} 项</span></div>`
            : ''
        }
        <div class="meeting-card-body">
          <div class="meeting-card-section">
            <h4 class="meeting-card-label">会议内容</h4>
            <p class="meeting-card-content">${escapeHtml(meeting.content || '')}</p>
          </div>
          <div class="meeting-card-section">
            <h4 class="meeting-card-label">Todo</h4>
            ${renderMeetingTodosHtml(meeting.todos)}
          </div>
        </div>
      `;

      card.querySelector('.meeting-card-toggle').addEventListener('click', () => toggleMeetingCard(card, meeting.id));
      card.querySelector('.btn-edit').addEventListener('click', () => editMeeting(meeting));
      card.querySelector('.btn-delete').addEventListener('click', () => deleteMeeting(meeting.id));
      list.appendChild(card);
    });
  }

  async function deleteSchedule(id) {
    if (!confirm('确定删除该固定日程？')) return;
    data.schedules = data.schedules.filter((s) => s.id !== id);
    data.scheduleCompletions = data.scheduleCompletions.filter((c) => c.scheduleId !== id);
    await persist();
    renderScheduleList();
    if (currentView === 'calendar') renderCalendar();
    if (currentView === 'schedules') renderScheduleList();
  }

  function updateScheduleFormVisibility() {
    const type = $('#sch-recurrence').value;
    $('#sch-dow').classList.toggle('hidden', type !== 'weekly' && type !== 'biweekly');
    $('#sch-dom').classList.toggle('hidden', type !== 'monthly');
  }

  async function changePasswordHandler() {
    const oldP = $('#pwd-old').value;
    const newP = $('#pwd-new').value;
    const newP2 = $('#pwd-new2').value;
    if (newP.length < 6) {
      alert('新密码至少 6 位');
      return;
    }
    if (newP !== newP2) {
      alert('两次新密码不一致');
      return;
    }
    try {
      await CryptoVault.changePassword(oldP, newP);
      password = newP;
      $('#pwd-old').value = '';
      $('#pwd-new').value = '';
      $('#pwd-new2').value = '';
      alert('密码已修改');
    } catch {
      alert('当前密码错误');
    }
  }

  async function exportBackupHandler() {
    const pwd = await promptPassword('请输入主密码以导出加密备份：', '导出加密备份');
    if (!pwd) return;
    try {
      const raw = await CryptoVault.exportBackup(pwd);
      downloadFile(`worklog-backup-${DateUtils.toDateKey(new Date())}.json`, raw, 'application/json');
    } catch {
      alert('密码错误或导出失败');
    }
  }

  async function importBackupHandler(e) {
    const file = e.target.files[0];
    if (!file) return;
    const pwd = await promptPassword('请输入备份文件的主密码：', '导入加密备份');
    if (!pwd) {
      e.target.value = '';
      return;
    }
    try {
      const text = await file.text();
      await CryptoVault.importBackup(pwd, text);
      await loadAndMigrateData(pwd);
      password = pwd;
      renderAll();
      refreshProjectSelects();
      renderProjectTagList();
      renderKeyProjectPickers();
      if (currentView === 'calendar') renderCalendar();
      if (currentView === 'schedules') renderScheduleList();
      if (currentView === 'meetings') renderMeetingList();
      alert('导入成功');
    } catch {
      alert('导入失败：密码错误或文件无效');
    }
    e.target.value = '';
  }

  async function wipeHandler() {
    const pwd = await promptPassword('此操作不可恢复。请输入主密码确认清空：', '清空全部数据');
    if (!pwd) return;
    try {
      await CryptoVault.loadEncrypted(pwd);
    } catch {
      alert('密码错误');
      return;
    }
    if (!confirm('最后确认：将删除所有日志、日程与总结，是否继续？')) return;
    CryptoVault.wipeAll();
    lock();
    setupLockScreen();
  }

  function setupLockScreen() {
    const hasData = CryptoVault.isInitialized();
    $('#lock-subtitle').textContent = hasData
      ? '请输入主密码解锁'
      : '暂无本地数据，请导入加密备份';
    $('#lock-form').classList.toggle('hidden', !hasData);
    $('#lock-import-panel').classList.toggle('hidden', hasData);
    $('#lock-confirm-wrap').classList.add('hidden');
    $('#lock-hint').classList.toggle('hidden', !hasData);
    $('#lock-password').value = '';
    $('#lock-import-password').value = '';
    $('#lock-import-backup').value = '';
    const insecure = !window.isSecureContext || !window.crypto?.subtle;
    $('#lock-insecure').classList.toggle('hidden', !insecure);
    $('#lock-submit').disabled = insecure;
    $('#lock-import-btn').disabled = insecure;
  }

  function downloadFile(name, content, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function init() {
    bindLockEvents();
    setupLockScreen();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
