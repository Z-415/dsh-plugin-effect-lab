'use strict';

/**
 * Electron main-process glue for the lab shell's desktop-only bridges.
 *
 * It lives in its own CommonJS module (copied next to main.js into the cached
 * runtime) so both branches are unit-testable with fake `dialog` and
 * `Notification` objects:
 *
 *   stub   deterministic: the picker returns the fixture directory and
 *          notifications are recorded without an OS toast, so automation
 *          never blocks and never spams the desktop.
 *   native real Electron: `dialog.showOpenDialog` and `Notification.show()`.
 *
 * The native folder dialog is modal, so callers must not run it during an
 * automated probe; the shell records it as wired but not auto-probed.
 */

const DIRECTORY_TITLE = 'DSH Plugin Effect Lab: choose a directory';

function createDesktopBridge(options = {}) {
  const mode = options.mode === 'native' ? 'native' : 'stub';
  const fixtureDir = options.fixtureDir ?? null;
  const dialog = options.dialog ?? null;
  const NotificationCtor = options.Notification ?? null;
  const getWindow = typeof options.getWindow === 'function' ? options.getWindow : () => null;

  const record = {
    mode,
    directoryPicker: {
      bridged: true,
      mode,
      stubbed: mode !== 'native',
      fixtureDir,
      called: false,
      autoProbed: options.autoProbe !== false,
      canceled: null,
      value: null,
      error: null,
    },
    notification: {
      bridged: true,
      mode,
      requested: 0,
      shown: 0,
      supported: null,
      suppressed: mode !== 'native',
      lastTitle: null,
      lastBody: null,
      error: null,
    },
  };

  async function pickDirectory() {
    record.directoryPicker.called = true;
    if (mode !== 'native') {
      record.directoryPicker.value = fixtureDir;
      return fixtureDir;
    }
    try {
      const dialogOptions = { title: DIRECTORY_TITLE, properties: ['openDirectory', 'createDirectory'] };
      if (fixtureDir) dialogOptions.defaultPath = fixtureDir;
      const result = await dialog.showOpenDialog(getWindow(), dialogOptions);
      const value = result?.canceled ? null : (result?.filePaths?.[0] ?? null);
      record.directoryPicker.canceled = result?.canceled === true;
      record.directoryPicker.value = value;
      return value;
    } catch (error) {
      record.directoryPicker.error = String(error?.message ?? error);
      return null;
    }
  }

  function notify(title, body) {
    const textTitle = String(title ?? '');
    const textBody = String(body ?? '');
    record.notification.requested += 1;
    record.notification.lastTitle = textTitle;
    record.notification.lastBody = textBody;
    if (mode !== 'native') {
      return { mode: 'stub', suppressed: true, shown: false, supported: null, title: textTitle, body: textBody };
    }
    const supported = Boolean(NotificationCtor)
      && (typeof NotificationCtor.isSupported === 'function' ? NotificationCtor.isSupported() === true : true);
    record.notification.supported = supported;
    if (!supported) {
      return { mode: 'native', suppressed: false, shown: false, supported: false, title: textTitle, body: textBody };
    }
    try {
      new NotificationCtor({ title: textTitle, body: textBody }).show();
      record.notification.shown += 1;
      return { mode: 'native', suppressed: false, shown: true, supported: true, title: textTitle, body: textBody };
    } catch (error) {
      const message = String(error?.message ?? error);
      record.notification.error = message;
      return {
        mode: 'native',
        suppressed: false,
        shown: false,
        supported,
        title: textTitle,
        body: textBody,
        error: message,
      };
    }
  }

  return { record, pickDirectory, notify };
}

module.exports = { createDesktopBridge, DIRECTORY_TITLE };
