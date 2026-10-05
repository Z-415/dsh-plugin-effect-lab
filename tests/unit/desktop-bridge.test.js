import assert from 'node:assert/strict';
import test from 'node:test';
import bridge from '../../src/electron-shell/desktop-bridge.cjs';

const { createDesktopBridge, DIRECTORY_TITLE } = bridge;

function fakeDialog(result) {
  const calls = [];
  return {
    calls,
    async showOpenDialog(window, options) {
      calls.push({ window, options });
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

test('stub mode returns the fixture directory and never opens a dialog', async () => {
  const dialog = fakeDialog({ canceled: false, filePaths: ['C:/native'] });
  const created = [];
  class FakeNotification {
    constructor(options) {
      created.push(options);
    }
    show() {}
  }
  FakeNotification.isSupported = () => true;
  const desktop = createDesktopBridge({
    mode: 'stub',
    fixtureDir: 'C:/lab/fixture',
    dialog,
    Notification: FakeNotification,
  });

  const picked = await desktop.pickDirectory();
  assert.equal(picked, 'C:/lab/fixture');
  assert.equal(dialog.calls.length, 0, 'the stub must not call the native dialog');
  assert.equal(desktop.record.directoryPicker.mode, 'stub');
  assert.equal(desktop.record.directoryPicker.stubbed, true);
  assert.equal(desktop.record.directoryPicker.called, true);

  const result = desktop.notify('t', 'b');
  assert.deepEqual(result, { mode: 'stub', suppressed: true, shown: false, supported: null, title: 't', body: 'b' });
  assert.equal(created.length, 0, 'the stub must not raise an OS toast');
  assert.equal(desktop.record.notification.requested, 1);
  assert.equal(desktop.record.notification.suppressed, true);
});

test('native mode opens a real dialog scoped to the fixture dir and returns the pick', async () => {
  const dialog = fakeDialog({ canceled: false, filePaths: ['C:/picked'] });
  const window = { id: 'main-window' };
  const desktop = createDesktopBridge({
    mode: 'native',
    fixtureDir: 'C:/lab/fixture',
    dialog,
    getWindow: () => window,
  });

  const picked = await desktop.pickDirectory();
  assert.equal(picked, 'C:/picked');
  assert.equal(dialog.calls.length, 1);
  assert.equal(dialog.calls[0].window, window);
  assert.equal(dialog.calls[0].options.title, DIRECTORY_TITLE);
  assert.deepEqual(dialog.calls[0].options.properties, ['openDirectory', 'createDirectory']);
  assert.equal(dialog.calls[0].options.defaultPath, 'C:/lab/fixture');
  assert.equal(desktop.record.directoryPicker.canceled, false);
  assert.equal(desktop.record.directoryPicker.value, 'C:/picked');
});

test('native mode records a cancel and a dialog error without throwing', async () => {
  const canceled = createDesktopBridge({ mode: 'native', dialog: fakeDialog({ canceled: true, filePaths: [] }) });
  assert.equal(await canceled.pickDirectory(), null);
  assert.equal(canceled.record.directoryPicker.canceled, true);

  const failed = createDesktopBridge({ mode: 'native', dialog: fakeDialog(new Error('no display')) });
  assert.equal(await failed.pickDirectory(), null);
  assert.equal(failed.record.directoryPicker.error, 'no display');
});

test('native mode raises a real notification and counts it', () => {
  const shown = [];
  class FakeNotification {
    constructor(options) {
      this.options = options;
    }
    show() {
      shown.push(this.options);
    }
  }
  FakeNotification.isSupported = () => true;
  const desktop = createDesktopBridge({ mode: 'native', Notification: FakeNotification });

  const result = desktop.notify('DSH', 'body');
  assert.deepEqual(result, { mode: 'native', suppressed: false, shown: true, supported: true, title: 'DSH', body: 'body' });
  assert.deepEqual(shown, [{ title: 'DSH', body: 'body' }]);
  assert.equal(desktop.record.notification.shown, 1);
  assert.equal(desktop.record.notification.requested, 1);
  assert.equal(desktop.record.notification.suppressed, false);
});

test('native mode reports an unsupported platform instead of throwing', () => {
  class FakeNotification {
    constructor() {
      throw new Error('should not be constructed');
    }
  }
  FakeNotification.isSupported = () => false;
  const desktop = createDesktopBridge({ mode: 'native', Notification: FakeNotification });

  const result = desktop.notify('t', 'b');
  assert.equal(result.shown, false);
  assert.equal(result.supported, false);
  assert.equal(desktop.record.notification.shown, 0);
  assert.equal(desktop.record.notification.supported, false);
});

test('native mode catches a notification constructor failure', () => {
  class FakeNotification {
    constructor() {
      throw new Error('toast blocked');
    }
    show() {}
  }
  FakeNotification.isSupported = () => true;
  const desktop = createDesktopBridge({ mode: 'native', Notification: FakeNotification });

  const result = desktop.notify('t', 'b');
  assert.equal(result.shown, false);
  assert.equal(result.error, 'toast blocked');
  assert.equal(desktop.record.notification.error, 'toast blocked');
});

test('native mode without a Notification constructor is treated as unsupported', () => {
  const desktop = createDesktopBridge({ mode: 'native' });
  const result = desktop.notify('t', 'b');
  assert.equal(result.supported, false);
  assert.equal(result.shown, false);
});
