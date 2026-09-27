import { detachPlayerForPip, reattachPlayerFromPip } from './musicPlayer.js';

export function initPip() {
  const button = document.getElementById('pip-button');
  const app = document.getElementById('app');
  const settingsButton = document.getElementById('settings-button');
  const originalParent = app.parentNode;
  const originalNextSibling = app.nextSibling;

  if (!('documentPictureInPicture' in window)) {
    // 非対応ブラウザ(Firefox/Safari等)ではボタンを表示せず、通常表示のみとする
    return;
  }
  button.hidden = false;

  button.addEventListener('click', async () => {
    if (window.documentPictureInPicture.window) {
      window.documentPictureInPicture.window.close();
      return;
    }

    detachPlayerForPip();
    settingsButton.hidden = true;

    const pipWindow = await window.documentPictureInPicture.requestWindow({
      width: 200,
      height: 480,
    });

    [...document.styleSheets].forEach((sheet) => {
      try {
        const cssText = [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
        const style = document.createElement('style');
        style.textContent = cssText;
        pipWindow.document.head.appendChild(style);
      } catch (e) {
        if (sheet.href) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = sheet.href;
          pipWindow.document.head.appendChild(link);
        }
      }
    });

    pipWindow.document.body.style.margin = '0';
    app.classList.add('is-pip');
    pipWindow.document.body.append(app);

    pipWindow.addEventListener('pagehide', () => {
      if (originalNextSibling) {
        originalParent.insertBefore(app, originalNextSibling);
      } else {
        originalParent.appendChild(app);
      }
      reattachPlayerFromPip();
      settingsButton.hidden = false;
      app.classList.remove('is-pip');
    }, { once: true });
  });
}
