let permissionRequested = false;

export async function ensureNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission !== 'default' || permissionRequested) return Notification.permission;
  permissionRequested = true;
  try {
    await Notification.requestPermission();
  } catch (e) {
    // 許可ダイアログが出せない環境では無視し、ページ内表示のみで動作を継続する
  }
  return Notification.permission;
}

export function showNotification(title, body, onClick) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const notification = new Notification(title, { body });
    if (onClick) {
      notification.onclick = () => {
        window.focus();
        onClick();
        notification.close();
      };
    }
  } catch (e) {
    // 通知の生成に失敗しても、タイマー本体の動作は継続する
  }
}
