import { getSettings, saveSettings } from './db.js';
import { ensureNotificationPermission, showNotification } from './notify.js';
import { getActiveTaskText } from './memoTask.js';

const TASK_LABEL_MAX_LENGTH = 8;

const els = {};
let workMinutes = 25;
let breakMinutes = 5;
let autoSwitch = false;
let mode = 'work'; // 'work' | 'break'
let remainingSeconds = workMinutes * 60;
let isRunning = false;
let endTimestamp = null;
let tickHandle = null;
const TICK_INTERVAL_MS = 250;
const tickListeners = [];

// 250msごとに実際に経過した時間を通知する(作業・休憩どちらの間も呼ばれる)。
// タスクの実績作業時間の自動加算など、他のモジュールから利用する。
export function onTick(callback) {
  tickListeners.push(callback);
}

function currentModeMinutes() {
  return mode === 'work' ? workMinutes : breakMinutes;
}

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function formatModeLabel() {
  if (mode !== 'work') return '休憩中';
  const taskText = getActiveTaskText();
  if (!taskText) return '作業中';
  const truncated = taskText.length > TASK_LABEL_MAX_LENGTH
    ? `${taskText.slice(0, TASK_LABEL_MAX_LENGTH)}…`
    : taskText;
  return `${truncated}作業中`;
}

function render() {
  els.modeLabel.textContent = formatModeLabel();
  els.display.textContent = formatTime(remainingSeconds);
  els.toggleBtn.textContent = isRunning ? '⏸' : '▶';
  els.toggleBtn.title = isRunning ? '一時停止' : '開始';
  els.switchLink.textContent = mode === 'work' ? '休憩に切り替え' : '作業に切り替え';
}

export function refreshModeLabel() {
  els.modeLabel.textContent = formatModeLabel();
}

function tick() {
  const remainingMs = endTimestamp - Date.now();
  if (remainingMs <= 0) {
    handleCycleEnd();
    return;
  }
  remainingSeconds = Math.round(remainingMs / 1000);
  tickListeners.forEach((cb) => {
    try {
      cb(TICK_INTERVAL_MS / 1000);
    } catch (e) {
      // リスナー側のエラーはタイマー本体の動作に影響させない
    }
  });
  render();
}

function startInterval() {
  clearInterval(tickHandle);
  tickHandle = setInterval(tick, TICK_INTERVAL_MS);
}

function handleCycleEnd() {
  const endedMode = mode;
  mode = endedMode === 'work' ? 'break' : 'work';
  remainingSeconds = currentModeMinutes() * 60;

  if (autoSwitch) {
    // 設定で自動継続が有効な場合のみ、次のサイクルのカウントダウンをそのまま続ける
    endTimestamp = Date.now() + remainingSeconds * 1000;
  } else {
    // 既定では自動で次に進めず、通知をクリックしたときだけ次を開始する
    pause();
  }

  showNotification(
    endedMode === 'work' ? '作業終了' : '休憩終了',
    endedMode === 'work' ? 'お疲れ様でした。休憩を始めましょう。' : '作業を再開しましょう。',
    () => {
      if (!isRunning) start();
    }
  );
  render();
}

async function start() {
  if (isRunning) return;
  await ensureNotificationPermission();
  isRunning = true;
  endTimestamp = Date.now() + remainingSeconds * 1000;
  startInterval();
  render();
}

function pause() {
  if (!isRunning) return;
  isRunning = false;
  clearInterval(tickHandle);
  tickHandle = null;
  render();
}

function toggle() {
  if (isRunning) {
    pause();
  } else {
    start();
  }
}

function reset() {
  pause();
  remainingSeconds = currentModeMinutes() * 60;
  render();
}

function switchModeManually() {
  mode = mode === 'work' ? 'break' : 'work';
  remainingSeconds = currentModeMinutes() * 60;
  if (isRunning) {
    endTimestamp = Date.now() + remainingSeconds * 1000;
    startInterval();
  }
  render();
}

function beginEditDisplay() {
  if (isRunning) return;
  els.display.hidden = true;
  els.displayInput.hidden = false;
  const currentMinutes = Math.min(180, Math.max(1, Math.round(remainingSeconds / 60)));
  els.hoursSelect.value = String(Math.floor(currentMinutes / 60));
  els.minutesSelect.value = String(currentMinutes % 60);
  els.hoursSelect.focus();
}

function closeEditDisplay() {
  els.displayInput.hidden = true;
  els.display.hidden = false;
  render();
}

// タイマー表示から時間を変更した場合、今回のカウントダウンだけでなく
// 以降のポモドーロサイクルもこの値を基準にする(設定パネルと同じ値を共有・保存する)
async function commitEditDisplay() {
  const hours = parseInt(els.hoursSelect.value, 10) || 0;
  const minutes = parseInt(els.minutesSelect.value, 10) || 0;
  const totalMinutes = Math.min(180, Math.max(1, hours * 60 + minutes));
  remainingSeconds = totalMinutes * 60;
  if (mode === 'work') {
    workMinutes = totalMinutes;
  } else {
    breakMinutes = totalMinutes;
  }
  await saveSettings({ workMinutes, breakMinutes });
  render();
}

function handleEditKeydown(e) {
  if (e.key === 'Enter' || e.key === 'Escape') {
    closeEditDisplay();
  }
}

function handleEditFocusOut(e) {
  if (!els.displayInput.contains(e.relatedTarget)) {
    closeEditDisplay();
  }
}

export async function initTimer() {
  els.modeLabel = document.getElementById('timer-mode-label');
  els.display = document.getElementById('timer-display');
  els.displayInput = document.getElementById('timer-display-input');
  els.hoursSelect = document.getElementById('timer-input-hours');
  els.minutesSelect = document.getElementById('timer-input-minutes');
  els.toggleBtn = document.getElementById('timer-toggle');
  els.resetBtn = document.getElementById('timer-reset');
  els.switchLink = document.getElementById('timer-switch-mode');

  const settings = await getSettings();
  workMinutes = settings.workMinutes;
  breakMinutes = settings.breakMinutes;
  autoSwitch = !!settings.autoSwitch;
  remainingSeconds = currentModeMinutes() * 60;

  for (let h = 0; h <= 3; h += 1) {
    const option = document.createElement('option');
    option.value = String(h);
    option.textContent = String(h);
    els.hoursSelect.appendChild(option);
  }
  for (let m = 0; m <= 59; m += 1) {
    const option = document.createElement('option');
    option.value = String(m);
    option.textContent = String(m);
    els.minutesSelect.appendChild(option);
  }

  els.toggleBtn.addEventListener('click', toggle);
  els.resetBtn.addEventListener('click', reset);
  els.switchLink.addEventListener('click', switchModeManually);
  els.display.addEventListener('click', beginEditDisplay);
  els.hoursSelect.addEventListener('change', commitEditDisplay);
  els.minutesSelect.addEventListener('change', commitEditDisplay);
  els.displayInput.addEventListener('focusout', handleEditFocusOut);
  els.displayInput.addEventListener('keydown', handleEditKeydown);

  render();
}

export function applySettingsChange(newWorkMinutes, newBreakMinutes, newAutoSwitch) {
  workMinutes = newWorkMinutes;
  breakMinutes = newBreakMinutes;
  if (typeof newAutoSwitch === 'boolean') autoSwitch = newAutoSwitch;
  if (!isRunning) {
    remainingSeconds = currentModeMinutes() * 60;
    render();
  }
}
