const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function event() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    async emit(...args) {
      await Promise.all(listeners.map((listener) => listener(...args)));
    },
  };
}

function loadBackground({ audioFails = false } = {}) {
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [2026, 6, 24, 0, 0, 0]));
    }
    static now() {
      return new Date(2026, 6, 24, 0, 0, 0).getTime();
    }
  }
  const calls = { notifications: [], windows: [] };
  const storage = {
    state: {
      running: true,
      paused: false,
      awaiting: false,
      phase: "SIT",
      nextPhase: null,
      phaseEndsAt: FixedDate.now(),
      cycle: 0,
    },
    settings: {
      durations: { SIT: 20, STAND: 8, WALK: 2 },
      soundEnabled: true,
      popupEnabled: true,
      snoozeMinutes: 5,
      workHoursEnabled: false,
      startHour: 9,
      endHour: 18,
    },
  };
  const alarms = new Map();
  const chrome = {
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setBadgeTextColor: async () => {},
    },
    alarms: {
      onAlarm: event(),
      create: async (name, options) => alarms.set(name, options),
      clear: async (name) => alarms.delete(name),
    },
    notifications: {
      onButtonClicked: event(),
      onClicked: event(),
      clear: async () => {},
      create: async (id, options) => calls.notifications.push({ id, options }),
    },
    offscreen: {
      hasDocument: async () => false,
      createDocument: async () => {
        if (audioFails) throw new Error("offscreen audio unavailable");
      },
    },
    runtime: {
      onInstalled: event(),
      onStartup: event(),
      onMessage: event(),
      getURL: (page) => `chrome-extension://test/${page}`,
      sendMessage: async () => {},
    },
    storage: {
      local: {
        get: async (key) => ({ [key]: storage[key] }),
        set: async (values) => Object.assign(storage, values),
        remove: async (key) => delete storage[key],
      },
    },
    windows: {
      onRemoved: event(),
      create: async (options) => {
        calls.windows.push(options);
        return { id: 42 };
      },
      remove: async () => {},
    },
  };

  const source = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  vm.runInNewContext(source, { chrome, console, Date: FixedDate });
  return { chrome, calls, storage };
}

test("phase end shows notification and focused alert window", async () => {
  const { chrome, calls, storage } = loadBackground();

  await chrome.alarms.onAlarm.emit({ name: "phase-timer" });

  assert.equal(storage.state.awaiting, true);
  assert.equal(storage.state.nextPhase, "STAND");
  assert.equal(calls.notifications.length, 1);
  assert.equal(calls.notifications[0].options.requireInteraction, true);
  assert.equal(calls.windows.length, 1);
  assert.equal(calls.windows[0].focused, true);
});

test("visual alerts still show when audio initialization fails", async () => {
  const { chrome, calls, storage } = loadBackground({ audioFails: true });

  await assert.doesNotReject(
    chrome.alarms.onAlarm.emit({ name: "phase-timer" }),
  );

  assert.equal(storage.state.awaiting, true);
  assert.equal(calls.notifications.length, 1);
  assert.equal(calls.windows.length, 1);
});
