import { requestPersistentStorage } from './db.js';
import { initTimer, applySettingsChange, onTick, refreshModeLabel } from './timer.js';
import { initMemoTask, addActiveTaskElapsedSeconds, onActiveTaskChange } from './memoTask.js';
import { initMusicPlayer } from './musicPlayer.js';
import { initSettingsBackup } from './settingsBackup.js';
import { initPip } from './pip.js';

async function init() {
  await requestPersistentStorage();
  await initTimer();
  await initMemoTask();
  await initMusicPlayer();
  await initSettingsBackup(applySettingsChange);
  initPip();

  // タイマーが動いている間(作業・休憩どちらも)、選択中のタスクの実績作業時間に加算する
  onTick(addActiveTaskElapsedSeconds);
  // 選択中タスクが切り替わったら、タイマーの「○○作業中」表示も更新する
  onActiveTaskChange(refreshModeLabel);
}

init();
