import { getSettings, saveSettings, exportAllData, importAllData, validateBackupShape } from './db.js';

const els = {};
let onSettingsChanged = null;

async function open() {
  await loadIntoInputs();
  els.overlay.hidden = false;
}

function close() {
  els.overlay.hidden = true;
}

function splitMinutes(totalMinutes) {
  const t = Math.min(180, Math.max(1, totalMinutes || 1));
  return { hours: Math.floor(t / 60), minutes: t % 60 };
}

function combineMinutes(hoursEl, minutesEl) {
  const h = parseInt(hoursEl.value, 10) || 0;
  const m = parseInt(minutesEl.value, 10) || 0;
  return Math.min(180, Math.max(1, h * 60 + m));
}

async function loadIntoInputs() {
  const settings = await getSettings();
  const work = splitMinutes(settings.workMinutes);
  const brk = splitMinutes(settings.breakMinutes);
  els.workHoursInput.value = work.hours;
  els.workMinutesInput.value = work.minutes;
  els.breakHoursInput.value = brk.hours;
  els.breakMinutesInput.value = brk.minutes;
  els.autoSwitchInput.checked = !!settings.autoSwitch;
}

async function handleWorkChange() {
  const n = combineMinutes(els.workHoursInput, els.workMinutesInput);
  const split = splitMinutes(n);
  els.workHoursInput.value = split.hours;
  els.workMinutesInput.value = split.minutes;
  const settings = await saveSettings({ workMinutes: n });
  if (onSettingsChanged) onSettingsChanged(settings.workMinutes, settings.breakMinutes, settings.autoSwitch);
}

async function handleBreakChange() {
  const n = combineMinutes(els.breakHoursInput, els.breakMinutesInput);
  const split = splitMinutes(n);
  els.breakHoursInput.value = split.hours;
  els.breakMinutesInput.value = split.minutes;
  const settings = await saveSettings({ breakMinutes: n });
  if (onSettingsChanged) onSettingsChanged(settings.workMinutes, settings.breakMinutes, settings.autoSwitch);
}

async function handleAutoSwitchChange() {
  const settings = await saveSettings({ autoSwitch: els.autoSwitchInput.checked });
  if (onSettingsChanged) onSettingsChanged(settings.workMinutes, settings.breakMinutes, settings.autoSwitch);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function handleExport() {
  const data = await exportAllData();
  const now = new Date();
  const filename = `pomodoro_backup_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
  downloadJson(data, filename);
}

function handleImportTrigger() {
  els.importFile.value = '';
  els.importFile.click();
}

async function handleImportFileSelected() {
  const file = els.importFile.files[0];
  if (!file) return;
  let data;
  try {
    const text = await file.text();
    data = JSON.parse(text);
  } catch (e) {
    alert('ファイルの形式が正しくありません');
    return;
  }
  if (!validateBackupShape(data)) {
    alert('ファイルの形式が正しくありません');
    return;
  }
  if (!confirm('現在のデータを上書きします。よろしいですか？')) return;
  await importAllData(data);
  alert('バックアップを読み込みました。画面を再読み込みします。');
  location.reload();
}

export async function initSettingsBackup(settingsChangedCallback) {
  onSettingsChanged = settingsChangedCallback;

  els.settingsButton = document.getElementById('settings-button');
  els.overlay = document.getElementById('settings-overlay');
  els.closeButton = document.getElementById('settings-close');
  els.workHoursInput = document.getElementById('setting-work-hours');
  els.workMinutesInput = document.getElementById('setting-work-minutes');
  els.breakHoursInput = document.getElementById('setting-break-hours');
  els.breakMinutesInput = document.getElementById('setting-break-minutes');
  els.autoSwitchInput = document.getElementById('setting-auto-switch');
  els.exportBtn = document.getElementById('backup-export');
  els.importTriggerBtn = document.getElementById('backup-import-trigger');
  els.importFile = document.getElementById('backup-import-file');

  await loadIntoInputs();

  els.settingsButton.addEventListener('click', open);
  els.closeButton.addEventListener('click', close);
  els.overlay.addEventListener('click', (e) => {
    if (e.target === els.overlay) close();
  });
  els.workHoursInput.addEventListener('change', handleWorkChange);
  els.workMinutesInput.addEventListener('change', handleWorkChange);
  els.breakHoursInput.addEventListener('change', handleBreakChange);
  els.breakMinutesInput.addEventListener('change', handleBreakChange);
  els.autoSwitchInput.addEventListener('change', handleAutoSwitchChange);
  els.exportBtn.addEventListener('click', handleExport);
  els.importTriggerBtn.addEventListener('click', handleImportTrigger);
  els.importFile.addEventListener('change', handleImportFileSelected);
}
