// ============================================================================
// Posture Break — background service worker (Manifest V3)
//
// หลักการสำคัญ (MV3): service worker ถูก Chrome kill ทิ้งเมื่อ idle
// ห้ามใช้ setInterval/setTimeout ตั้งเวลาเด็ดขาด — มันจะตายตอน worker ถูกหยุด
// เราใช้ chrome.alarms ทั้งหมด เพราะ alarm อยู่รอดข้าม worker restart
// state ทั้งหมดเก็บใน chrome.storage.local เพื่อกู้คืนได้เมื่อ worker ถูกปลุก
// ============================================================================

// ---- นิยามเฟส (state machine วน SIT -> STAND -> WALK -> SIT ...) -------------
const PHASES = {
  SIT:   { key: "SIT",   label: "นั่งทำงาน",      verb: "นั่งทำงานได้เลย",        emoji: "🪑", color: "#3B82F6", hold: false },
  STAND: { key: "STAND", label: "ยืนทำงาน",       verb: "ลุกขึ้นยืนทำงาน",        emoji: "🧍", color: "#F59E0B", hold: true  },
  WALK:  { key: "WALK",  label: "เดิน/ยืดเหยียด", verb: "ลุกเดินหรือยืดเหยียดร่างกาย", emoji: "🚶", color: "#10B981", hold: true  },
};
const PHASE_ORDER = ["SIT", "STAND", "WALK"];

// ---- ค่าตั้งต้น (กฎ 20-8-2 ในรอบ 30 นาที) ---------------------------------
const DEFAULT_SETTINGS = {
  durations:       { SIT: 20, STAND: 8, WALK: 2 }, // นาทีต่อเฟส
  soundEnabled:    true,
  snoozeMinutes:   5,
  workHoursEnabled: true,
  startHour:       9,   // เริ่มเตือน 09:00
  endHour:         18,  // หยุดเตือน 18:00
};

const PHASE_ALARM = "phase-timer"; // alarm หลัก: จับเวลาแต่ละเฟส
const TICK_ALARM  = "tick";        // alarm รอง: อัปเดต badge นับถอยหลังทุก 1 นาที
const RESUME_ALARM = "resume";     // alarm สำหรับปลุกกลับหลัง snooze

// ============================================================================
// State helpers
// ============================================================================
async function getState() {
  const { state } = await chrome.storage.local.get("state");
  return state || { running: false, paused: false, phase: "SIT", phaseEndsAt: 0, cycle: 0 };
}
async function setState(patch) {
  const state = await getState();
  const next = { ...state, ...patch };
  await chrome.storage.local.set({ state: next });
  return next;
}
async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

// ============================================================================
// Work hours
// ============================================================================
function withinWorkHours(settings, date = new Date()) {
  if (!settings.workHoursEnabled) return true;
  const h = date.getHours();
  // รองรับช่วงข้ามเที่ยงคืน (เช่น 22 -> 6) เผื่อคนทำงานกลางคืน
  if (settings.startHour <= settings.endHour) {
    return h >= settings.startHour && h < settings.endHour;
  }
  return h >= settings.startHour || h < settings.endHour;
}

// ============================================================================
// Badge — แสดงนาทีที่เหลือ + สีตามเฟส
// ============================================================================
async function updateBadge() {
  const state = await getState();
  if (!state.running) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  if (state.paused) {
    await chrome.action.setBadgeText({ text: "⏸" });
    await chrome.action.setBadgeBackgroundColor({ color: "#6B7280" });
    return;
  }
  const phase = PHASES[state.phase];
  const remainMs = state.phaseEndsAt - Date.now();
  const remainMin = Math.max(0, Math.ceil(remainMs / 60000));
  await chrome.action.setBadgeText({ text: String(remainMin) });
  await chrome.action.setBadgeBackgroundColor({ color: phase.color });
}

// ============================================================================
// เริ่มเฟสใหม่: ตั้ง phaseEndsAt + สร้าง alarm + แจ้งเตือน
// ============================================================================
async function enterPhase(phaseKey, { notify = true } = {}) {
  const settings = await getSettings();
  const minutes = settings.durations[phaseKey];
  const phaseEndsAt = Date.now() + minutes * 60000;

  await setState({ running: true, paused: false, phase: phaseKey, phaseEndsAt });

  // alarm หลัก: ยิงเมื่อหมดเวลาเฟสนี้
  await chrome.alarms.create(PHASE_ALARM, { when: phaseEndsAt });

  await updateBadge();

  if (notify) await showPhaseNotification(phaseKey, minutes, settings);
}

// เลื่อนไปเฟสถัดไปในวงจร
async function advancePhase() {
  const state = await getState();
  const idx = PHASE_ORDER.indexOf(state.phase);
  const nextKey = PHASE_ORDER[(idx + 1) % PHASE_ORDER.length];
  const cycle = nextKey === "SIT" ? state.cycle + 1 : state.cycle;
  await setState({ cycle });
  await enterPhase(nextKey);
}

// ============================================================================
// Notifications
// ============================================================================
async function showPhaseNotification(phaseKey, minutes, settings) {
  if (!withinWorkHours(settings)) return; // นอกเวลางาน: เงียบไว้

  const phase = PHASES[phaseKey];
  const title = `${phase.emoji} ถึงเวลา${phase.label}`;
  const message = `${phase.verb} ประมาณ ${minutes} นาที`;

  await chrome.notifications.clear("posture");
  await chrome.notifications.create("posture", {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
    priority: 2,
    requireInteraction: phase.hold, // STAND/WALK ค้างไว้จนกว่าจะกด — บังคับให้เห็น
    silent: !settings.soundEnabled,
    buttons: [
      { title: "รับทราบ" },
      { title: `เลื่อน ${settings.snoozeMinutes} นาที` },
    ],
  });
}

chrome.notifications.onButtonClicked.addListener(async (id, btnIdx) => {
  if (id !== "posture") return;
  await chrome.notifications.clear("posture");
  if (btnIdx === 1) await snooze(); // ปุ่มที่สอง = เลื่อน
});

chrome.notifications.onClicked.addListener(async (id) => {
  if (id === "posture") await chrome.notifications.clear("posture");
});

// ============================================================================
// Snooze / Pause / Resume / Skip
// ============================================================================
async function snooze() {
  const settings = await getSettings();
  await chrome.alarms.clear(PHASE_ALARM);
  await setState({ paused: true });
  await chrome.alarms.create(RESUME_ALARM, {
    when: Date.now() + settings.snoozeMinutes * 60000,
  });
  await updateBadge();
}

async function pause() {
  await chrome.alarms.clear(PHASE_ALARM);
  await chrome.alarms.clear(RESUME_ALARM);
  await setState({ paused: true });
  await updateBadge();
}

async function resume() {
  const state = await getState();
  // กลับมาเฟสเดิม โดยจับเวลาที่เหลือใหม่จากปัจจุบัน (เริ่มเฟสเดิมใหม่หมด)
  await chrome.alarms.clear(RESUME_ALARM);
  await enterPhase(state.phase || "SIT", { notify: false });
}

async function skipToNext() {
  await chrome.alarms.clear(PHASE_ALARM);
  await advancePhase();
}

async function start() {
  await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  await setState({ cycle: 0 });
  await enterPhase("SIT");
}

async function stop() {
  await chrome.alarms.clear(PHASE_ALARM);
  await chrome.alarms.clear(TICK_ALARM);
  await chrome.alarms.clear(RESUME_ALARM);
  await setState({ running: false, paused: false });
  await chrome.action.setBadgeText({ text: "" });
}

// ============================================================================
// Alarm router
// ============================================================================
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === PHASE_ALARM) {
    await advancePhase();
  } else if (alarm.name === RESUME_ALARM) {
    await resume();
  } else if (alarm.name === TICK_ALARM) {
    await updateBadge();
  }
});

// ============================================================================
// Lifecycle
// ============================================================================
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await chrome.storage.local.set({ settings });
  await chrome.action.setBadgeTextColor?.({ color: "#FFFFFF" });
  await start();
});

// ถูกปลุกตอนเปิด Chrome — กู้ badge + ต่อ tick ให้ทำงาน
chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  if (state.running) {
    await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
    // กันกรณี phase alarm หาย: ถ้าหมดเวลาไปแล้วให้เลื่อนเฟส
    if (!state.paused && state.phaseEndsAt <= Date.now()) {
      await advancePhase();
    }
    await updateBadge();
  }
});

// ============================================================================
// Messages จาก popup / options
// ============================================================================
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "GET_STATE": {
        const [state, settings] = [await getState(), await getSettings()];
        sendResponse({ state, settings, phases: PHASES, order: PHASE_ORDER });
        break;
      }
      case "PAUSE":   await pause();      sendResponse({ ok: true }); break;
      case "RESUME":  await resume();     sendResponse({ ok: true }); break;
      case "SKIP":    await skipToNext(); sendResponse({ ok: true }); break;
      case "RESTART": await start();      sendResponse({ ok: true }); break;
      case "STOP":    await stop();       sendResponse({ ok: true }); break;
      case "SAVE_SETTINGS": {
        await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ...msg.settings } });
        // เริ่มเฟสปัจจุบันใหม่เพื่อใช้ระยะเวลาที่อัปเดต
        const state = await getState();
        if (state.running && !state.paused) await enterPhase(state.phase, { notify: false });
        sendResponse({ ok: true });
        break;
      }
      default: sendResponse({ ok: false, error: "unknown message" });
    }
  })();
  return true; // async response
});
