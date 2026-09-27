import { getAll, put, putMany, remove, generateId } from './db.js';

const els = {};
const state = {
  tasks: [],
  activeTaskId: null,
  detailTab: 'memo',
};

// 選択中タスクのテキストが変わったとき(選択切り替え・削除・リネーム)に
// 他モジュール(タイマーの「○○作業中」表示など)へ知らせるための購読口
const activeTaskListeners = [];
export function onActiveTaskChange(callback) {
  activeTaskListeners.push(callback);
}
function notifyActiveTaskChange() {
  activeTaskListeners.forEach((cb) => {
    try {
      cb();
    } catch (e) {
      // リスナー側のエラーはタスク管理の動作に影響させない
    }
  });
}

export function getActiveTaskText() {
  const task = state.tasks.find((t) => t.id === state.activeTaskId);
  return task ? task.text : null;
}

function attachDragReorder(container, itemSelector, orientation, onReorder) {
  let draggedEl = null;

  container.addEventListener('dragstart', (e) => {
    const item = e.target.closest(itemSelector);
    if (!item) return;
    draggedEl = item;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.dataset.id || '');
  });

  container.addEventListener('dragover', (e) => {
    if (!draggedEl) return;
    const target = e.target.closest(itemSelector);
    if (!target || target === draggedEl) return;
    e.preventDefault();
    const rect = target.getBoundingClientRect();
    const before = orientation === 'horizontal'
      ? (e.clientX - rect.left) < rect.width / 2
      : (e.clientY - rect.top) < rect.height / 2;
    if (before) {
      target.parentNode.insertBefore(draggedEl, target);
    } else {
      target.parentNode.insertBefore(draggedEl, target.nextSibling);
    }
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
  });

  container.addEventListener('dragend', () => {
    if (!draggedEl) return;
    const ids = Array.from(container.querySelectorAll(itemSelector)).map((el) => el.dataset.id);
    draggedEl = null;
    onReorder(ids);
  });
}

function todayDateString() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function splitMinutesValue(totalMinutes) {
  const t = Math.max(0, totalMinutes || 0);
  return { hours: Math.floor(t / 60), minutes: t % 60 };
}

function splitSecondsValue(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  return { hours: Math.floor(s / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 };
}

// --- タスク ---

function sortedTasksForDisplay(tasks) {
  const incomplete = tasks.filter((t) => !t.done).sort((a, b) => a.order - b.order);
  const completed = tasks.filter((t) => t.done).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  return [...incomplete, ...completed];
}

function renderTasks() {
  const list = sortedTasksForDisplay(state.tasks);
  const today = todayDateString();
  els.taskList.innerHTML = '';
  list.forEach((task) => {
    const isOverdue = !task.done && task.dueDate && task.dueDate < today;
    const li = document.createElement('li');
    li.className = 'task-item'
      + (task.done ? ' is-done' : '')
      + (task.id === state.activeTaskId ? ' is-active' : '')
      + (isOverdue ? ' is-overdue' : '');
    li.dataset.id = task.id;
    li.title = 'クリックして詳細を表示、ダブルクリックで編集';
    if (!task.done) li.draggable = true;
    li.addEventListener('click', () => setActiveTask(task.id));
    li.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      beginEditTask(task, li);
    });

    const handle = document.createElement('span');
    handle.className = 'task-drag-handle';
    handle.textContent = '≡';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-checkbox';
    checkbox.checked = task.done;
    checkbox.addEventListener('click', (e) => e.stopPropagation());
    checkbox.addEventListener('dblclick', (e) => e.stopPropagation());
    checkbox.addEventListener('change', () => toggleTaskDone(task.id, checkbox.checked));

    const text = document.createElement('span');
    text.className = 'task-text';
    text.textContent = task.text;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'task-delete-btn';
    del.title = 'タスクを削除';
    del.textContent = '×';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTask(task.id);
    });
    del.addEventListener('dblclick', (e) => e.stopPropagation());

    li.append(handle, checkbox, text);
    if (task.dueDate) {
      const badge = document.createElement('span');
      badge.className = 'task-due-badge';
      const [, m, d] = task.dueDate.split('-');
      badge.textContent = `${Number(m)}/${Number(d)}`;
      li.append(badge);
    }
    li.append(del);
    els.taskList.appendChild(li);
  });
}

function beginEditTask(task, li) {
  const textEl = li.querySelector('.task-text');
  if (!textEl) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'task-text-input';
  input.value = task.text;

  const commit = async () => {
    input.removeEventListener('blur', commit);
    const value = input.value.trim();
    if (value && value !== task.text) {
      task.text = value;
      task.updatedAt = Date.now();
      await put('tasks', task);
      if (task.id === state.activeTaskId) notifyActiveTaskChange();
    }
    renderTasks();
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      input.blur();
    } else if (e.key === 'Escape') {
      input.removeEventListener('blur', commit);
      renderTasks();
    }
  });
  input.addEventListener('click', (e) => e.stopPropagation());

  textEl.replaceWith(input);
  input.focus();
  input.select();
}

// シングルクリックではタスク一覧を再描画しない(renderTasksを呼ぶとDOM要素が
// 作り直され、ダブルクリックの2回目のクリックが別要素に当たってdblclickが
// 発火しなくなるため、ハイライトの付け替えだけをその場で行う)
function setActiveTask(id) {
  flushActualPersist();

  const prevActiveEl = els.taskList.querySelector('.task-item.is-active');
  if (prevActiveEl) prevActiveEl.classList.remove('is-active');

  state.activeTaskId = id;
  const task = state.tasks.find((t) => t.id === id);
  renderTaskDetail(task);
  notifyActiveTaskChange();

  const newActiveEl = els.taskList.querySelector(`[data-id="${id}"]`);
  if (newActiveEl) newActiveEl.classList.add('is-active');
}

function renderTaskDetail(task) {
  const hasTask = !!task;
  els.memoBody.value = task ? (task.memo || '') : '';
  els.memoBody.disabled = !hasTask;
  els.dueDateInput.value = task && task.dueDate ? task.dueDate : '';
  els.dueDateInput.disabled = !hasTask;

  const est = splitMinutesValue(task ? task.estimateMinutes : 0);
  els.estimateHoursInput.value = est.hours || '';
  els.estimateMinutesInput.value = est.minutes || '';
  els.estimateHoursInput.disabled = !hasTask;
  els.estimateMinutesInput.disabled = !hasTask;

  const act = splitSecondsValue(task ? task.actualSeconds : 0);
  els.actualHoursInput.value = act.hours || '';
  els.actualMinutesInput.value = act.minutes || '';
  els.actualSecondsDisplay.textContent = `${String(act.seconds).padStart(2, '0')}秒`;
  els.actualHoursInput.disabled = !hasTask;
  els.actualMinutesInput.disabled = !hasTask;

  els.detailLabel.textContent = task ? `「${task.text}」の詳細` : 'タスクを選択すると詳細を編集できます';
}

function setDetailTab(tab) {
  state.detailTab = tab;
  els.detailTabFields.classList.toggle('is-active', tab === 'fields');
  els.detailTabMemo.classList.toggle('is-active', tab === 'memo');
  els.detailFields.hidden = tab !== 'fields';
  els.memoBody.hidden = tab !== 'memo';
}

async function addTask(rawText) {
  const text = rawText.trim();
  if (!text) return;
  const maxOrder = Math.max(-1, ...state.tasks.filter((t) => !t.done).map((t) => t.order));
  const task = {
    id: generateId(),
    text,
    done: false,
    order: maxOrder + 1,
    completedAt: null,
    memo: '',
    dueDate: null,
    estimateMinutes: null,
    actualSeconds: 0,
    updatedAt: Date.now(),
  };
  state.tasks.push(task);
  await put('tasks', task);
  renderTasks();
}

async function toggleTaskDone(id, done) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  task.done = done;
  task.completedAt = done ? Date.now() : null;
  task.updatedAt = Date.now();
  if (!done) {
    const maxOrder = Math.max(-1, ...state.tasks.filter((t) => !t.done && t.id !== id).map((t) => t.order));
    task.order = maxOrder + 1;
  }
  await put('tasks', task);
  renderTasks();
}

async function deleteTask(id) {
  if (state.activeTaskId === id) {
    // 削除するタスク宛ての保留中の実績時間保存があれば、削除後に復活してしまう前に取り消す
    cancelActualPersist();
  }
  state.tasks = state.tasks.filter((t) => t.id !== id);
  await remove('tasks', id);
  if (state.activeTaskId === id) {
    state.activeTaskId = null;
    renderTaskDetail(null);
    notifyActiveTaskChange();
  }
  renderTasks();
}

async function reorderIncompleteTasks(orderedIds) {
  orderedIds.forEach((id, index) => {
    const task = state.tasks.find((t) => t.id === id);
    if (task) task.order = index;
  });
  const changed = orderedIds.map((id) => state.tasks.find((t) => t.id === id)).filter(Boolean);
  if (changed.length) await putMany('tasks', changed);
  renderTasks();
}

// --- メモ・期限・見積(選択中のタスクに紐づく) ---

let bodySaveTimer = null;
function onMemoBodyInput() {
  clearTimeout(bodySaveTimer);
  bodySaveTimer = setTimeout(saveActiveTaskMemo, 500);
}

async function saveActiveTaskMemo() {
  const task = state.tasks.find((t) => t.id === state.activeTaskId);
  if (!task) return;
  task.memo = els.memoBody.value;
  task.updatedAt = Date.now();
  await put('tasks', task);
}

async function handleDueDateChange() {
  const task = state.tasks.find((t) => t.id === state.activeTaskId);
  if (!task) return;
  task.dueDate = els.dueDateInput.value || null;
  task.updatedAt = Date.now();
  await put('tasks', task);
  renderTasks();
}

async function handleEstimateChange() {
  const task = state.tasks.find((t) => t.id === state.activeTaskId);
  if (!task) return;
  const h = Math.min(99, Math.max(0, parseInt(els.estimateHoursInput.value, 10) || 0));
  const m = Math.min(59, Math.max(0, parseInt(els.estimateMinutesInput.value, 10) || 0));
  task.estimateMinutes = h * 60 + m;
  els.estimateHoursInput.value = h || '';
  els.estimateMinutesInput.value = m || '';
  task.updatedAt = Date.now();
  await put('tasks', task);
}

async function handleActualChange() {
  const task = state.tasks.find((t) => t.id === state.activeTaskId);
  if (!task) return;
  cancelActualPersist();
  const h = Math.min(99, Math.max(0, parseInt(els.actualHoursInput.value, 10) || 0));
  const m = Math.min(59, Math.max(0, parseInt(els.actualMinutesInput.value, 10) || 0));
  const currentSecondsRemainder = Math.round(task.actualSeconds || 0) % 60;
  task.actualSeconds = h * 3600 + m * 60 + currentSecondsRemainder;
  els.actualHoursInput.value = h || '';
  els.actualMinutesInput.value = m || '';
  task.updatedAt = Date.now();
  await put('tasks', task);
}

// --- 実績作業時間の自動加算 ---
// タイマーが動いている間(作業・休憩どちらも)、選択中のタスクの実績時間を
// その場で加算する。DBへの書き込みは負荷軽減のため間引いて行う。

let actualPersistTimer = null;

async function persistTask(task) {
  task.updatedAt = Date.now();
  await put('tasks', task);
}

function scheduleActualPersist(task) {
  if (actualPersistTimer) return;
  actualPersistTimer = setTimeout(() => {
    actualPersistTimer = null;
    persistTask(task);
  }, 3000);
}

function cancelActualPersist() {
  if (!actualPersistTimer) return;
  clearTimeout(actualPersistTimer);
  actualPersistTimer = null;
}

function flushActualPersist() {
  if (!actualPersistTimer) return;
  const task = state.tasks.find((t) => t.id === state.activeTaskId);
  cancelActualPersist();
  if (task) persistTask(task);
}

export function addActiveTaskElapsedSeconds(deltaSeconds) {
  const task = state.tasks.find((t) => t.id === state.activeTaskId);
  if (!task) return;
  task.actualSeconds = (task.actualSeconds || 0) + deltaSeconds;
  const act = splitSecondsValue(task.actualSeconds);
  // 時間・分の欄を編集中(フォーカス中)は入力値を勝手に上書きしない
  if (document.activeElement !== els.actualHoursInput && document.activeElement !== els.actualMinutesInput) {
    els.actualHoursInput.value = act.hours || '';
    els.actualMinutesInput.value = act.minutes || '';
  }
  els.actualSecondsDisplay.textContent = `${String(act.seconds).padStart(2, '0')}秒`;
  scheduleActualPersist(task);
}

export async function initMemoTask() {
  els.detailLabel = document.getElementById('memo-task-label');
  els.detailTabFields = document.getElementById('task-detail-tab-fields');
  els.detailTabMemo = document.getElementById('task-detail-tab-memo');
  els.detailFields = document.getElementById('task-detail-fields');
  els.memoBody = document.getElementById('memo-body');
  els.dueDateInput = document.getElementById('task-due-date');
  els.estimateHoursInput = document.getElementById('task-estimate-hours');
  els.estimateMinutesInput = document.getElementById('task-estimate-minutes');
  els.actualHoursInput = document.getElementById('task-actual-hours');
  els.actualMinutesInput = document.getElementById('task-actual-minutes');
  els.actualSecondsDisplay = document.getElementById('task-actual-seconds');
  els.taskInput = document.getElementById('task-input');
  els.taskAddBtn = document.getElementById('task-add');
  els.taskList = document.getElementById('task-list');

  state.tasks = await getAll('tasks');

  renderTasks();
  setDetailTab(state.detailTab);

  els.detailTabFields.addEventListener('click', () => setDetailTab('fields'));
  els.detailTabMemo.addEventListener('click', () => setDetailTab('memo'));
  els.memoBody.addEventListener('input', onMemoBodyInput);
  els.dueDateInput.addEventListener('change', handleDueDateChange);
  els.estimateHoursInput.addEventListener('change', handleEstimateChange);
  els.estimateMinutesInput.addEventListener('change', handleEstimateChange);
  els.actualHoursInput.addEventListener('change', handleActualChange);
  els.actualMinutesInput.addEventListener('change', handleActualChange);
  els.taskAddBtn.addEventListener('click', () => {
    addTask(els.taskInput.value);
    els.taskInput.value = '';
  });
  els.taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addTask(els.taskInput.value);
      els.taskInput.value = '';
    }
  });

  attachDragReorder(els.taskList, '.task-item:not(.is-done)', 'vertical', reorderIncompleteTasks);

  window.addEventListener('beforeunload', flushActualPersist);
}
