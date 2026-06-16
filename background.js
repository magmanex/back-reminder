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
  popupEnabled:    true,  // เด้งหน้าต่าง popup ตอนเปลี่ยนเฟส (กันพลาดถ้าไม่เห็น notification)
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
  return state || { running: false, paused: false, awaiting: false, phase: "SIT", nextPhase: null, phaseEndsAt: 0, cycle: 0 };
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
  if (state.awaiting) {
    // หมดเวลาแล้ว รอ user กดเปลี่ยนท่า — ขึ้น ! สีตามท่าถัดไป
    const next = PHASES[state.nextPhase] || PHASES[state.phase];
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: next.color });
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
// เริ่มจับเวลาเฟส (ไม่เด้งเตือน — การเตือนเกิดตอน "หมดเวลา" ใน onPhaseEnd)
async function enterPhase(phaseKey) {
  const settings = await getSettings();
  const minutes = settings.durations[phaseKey];
  const phaseEndsAt = Date.now() + minutes * 60000;

  await setState({ running: true, paused: false, awaiting: false, nextPhase: null, phase: phaseKey, phaseEndsAt });

  // alarm หลัก: ยิงเมื่อหมดเวลาเฟสนี้ → onPhaseEnd
  await chrome.alarms.create(PHASE_ALARM, { when: phaseEndsAt });

  await updateBadge();
}

// หมดเวลาเฟสปัจจุบัน: ยังไม่เปลี่ยนท่าทันที — เด้งเตือนรอ user กด "เริ่มท่าถัดไป"
async function onPhaseEnd() {
  const state = await getState();
  const idx = PHASE_ORDER.indexOf(state.phase);
  const nextKey = PHASE_ORDER[(idx + 1) % PHASE_ORDER.length];

  await chrome.alarms.clear(PHASE_ALARM);
  await setState({ awaiting: true, nextPhase: nextKey });
  await updateBadge();

  const settings = await getSettings();
  await playBeep(settings);
  await showChangeNotification(nextKey, settings);
  await showChangePopup(settings);
}

// user กดยืนยัน (จาก popup / notification / ปุ่ม skip) → เข้าท่าถัดไปจริง
async function advance() {
  const state = await getState();
  const idx = PHASE_ORDER.indexOf(state.phase);
  const nextKey = state.nextPhase || PHASE_ORDER[(idx + 1) % PHASE_ORDER.length];
  const cycle = nextKey === "SIT" ? state.cycle + 1 : state.cycle;

  await chrome.notifications.clear("posture");
  await closeAlertWindow();
  await setState({ cycle });
  await enterPhase(nextKey);
}

// ============================================================================
// เสียงเตือน — MV3 service worker ไม่มี DOM/Audio เล่นเสียงผ่าน offscreen document
// (กฎเหล็กข้อ 3) สร้าง doc ครั้งเดียวแล้วใช้ซ้ำ ส่ง message ไปสั่งเล่น beep
// ============================================================================
async function playBeep(settings) {
  if (!settings.soundEnabled) return;
  if (!withinWorkHours(settings)) return;
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "เล่นเสียงเตือนตอนถึงเวลาเปลี่ยนท่าทาง",
    });
  }
  await chrome.runtime.sendMessage({ type: "PLAY_BEEP" });
}

// ============================================================================
// Notifications
// ============================================================================
// เด้งตอนหมดเวลา: บอกท่าถัดไป + ปุ่มเริ่ม/เลื่อน (requireInteraction ค้างจนกด)
async function showChangeNotification(nextKey, settings) {
  if (!withinWorkHours(settings)) return; // นอกเวลางาน: เงียบไว้

  const next = PHASES[nextKey];
  await chrome.notifications.clear("posture");
  await chrome.notifications.create("posture", {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: `⏰ หมดเวลาแล้ว — ถึงเวลา${next.label} ${next.emoji}`,
    message: `${next.verb} (กดเพื่อเริ่ม)`,
    priority: 2,
    requireInteraction: true, // เป็นการรอ action — ค้างไว้จนกด
    silent: !settings.soundEnabled,
    buttons: [
      { title: `เริ่ม${next.label}` },
      { title: `เลื่อน ${settings.snoozeMinutes} นาที` },
    ],
  });
}

chrome.notifications.onButtonClicked.addListener(async (id, btnIdx) => {
  if (id !== "posture") return;
  await chrome.notifications.clear("posture");
  if (btnIdx === 0) await advance(); // เริ่มท่าถัดไป
  else await snooze();               // เลื่อน
});

chrome.notifications.onClicked.addListener(async (id) => {
  if (id !== "posture") return;
  await advance(); // คลิกตัวแจ้งเตือน = เริ่มท่าถัดไป
});

// ============================================================================
// Popup window — เด้งหน้าต่างจริงตอนเปลี่ยนเฟส กันพลาดถ้าไม่เห็น notification
// chrome.windows ไม่ต้องขอ permission เพิ่ม
// เก็บ window id ใน storage (ห้ามใช้ตัวแปร global — worker ถูก kill แล้วหาย)
// ============================================================================
const ALERT_PAGE = "alert.html";

async function closeAlertWindow() {
  const { alertWindowId } = await chrome.storage.local.get("alertWindowId");
  if (alertWindowId != null) {
    try { await chrome.windows.remove(alertWindowId); } catch (_) {}
    await chrome.storage.local.remove("alertWindowId");
  }
}

async function showChangePopup(settings) {
  if (!settings.popupEnabled) return;
  if (!withinWorkHours(settings)) return; // นอกเวลางาน: ไม่เด้ง

  await closeAlertWindow(); // กันเด้งซ้อนกันหลายบาน

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(ALERT_PAGE),
    type: "popup",
    focused: true,
    width: 440,
    height: 360,
  });
  await chrome.storage.local.set({ alertWindowId: win.id });
}

// ล้าง id เมื่อผู้ใช้ปิดหน้าต่างเอง
chrome.windows.onRemoved.addListener(async (winId) => {
  const { alertWindowId } = await chrome.storage.local.get("alertWindowId");
  if (winId === alertWindowId) await chrome.storage.local.remove("alertWindowId");
});

// ============================================================================
// Snooze / Pause / Resume / Skip
// ============================================================================
// เลื่อน: ปิดเตือนที่ค้างอยู่ แล้วตั้งปลุกมาเตือนซ้ำอีกที
async function snooze() {
  const settings = await getSettings();
  await chrome.notifications.clear("posture");
  await closeAlertWindow();
  await setState({ paused: true });
  await chrome.alarms.create(RESUME_ALARM, {
    when: Date.now() + settings.snoozeMinutes * 60000,
  });
  await updateBadge();
}

async function pause() {
  const state = await getState();
  await chrome.alarms.clear(PHASE_ALARM);
  await chrome.alarms.clear(RESUME_ALARM);
  // เก็บเวลาที่เหลือไว้ เพื่อ resume แล้วนับต่อ (ไม่ reset เฟส)
  const remainMs = Math.max(0, state.phaseEndsAt - Date.now());
  await setState({ paused: true, remainMs });
  await updateBadge();
}

async function resume() {
  await chrome.alarms.clear(RESUME_ALARM);
  const state = await getState();
  if (state.awaiting) {
    // ระหว่างรอเปลี่ยนท่าแล้ว snooze → ปลุกมาเตือนเปลี่ยนท่าซ้ำ
    await setState({ paused: false });
    await updateBadge();
    const settings = await getSettings();
    await playBeep(settings);
    await showChangeNotification(state.nextPhase, settings);
    await showChangePopup(settings);
  } else {
    // นับต่อจากเวลาที่เหลือตอน pause (ไม่ reset เฟส)
    const settings = await getSettings();
    const fullMs = (settings.durations[state.phase] || 1) * 60000;
    const remainMs = state.remainMs != null ? state.remainMs : fullMs;
    if (remainMs <= 0) { await onPhaseEnd(); return; }
    const phaseEndsAt = Date.now() + remainMs;
    await setState({ running: true, paused: false, remainMs: null, phaseEndsAt });
    await chrome.alarms.create(PHASE_ALARM, { when: phaseEndsAt });
    await updateBadge();
  }
}

async function skipToNext() {
  await chrome.alarms.clear(PHASE_ALARM);
  await advance();
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
    await onPhaseEnd();
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
    // กันกรณี phase alarm หาย: ถ้าหมดเวลาไปแล้วและยังไม่ค้างเตือน → เด้งเตือนเปลี่ยนท่า
    if (!state.paused && !state.awaiting && state.phaseEndsAt <= Date.now()) {
      await onPhaseEnd();
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
      case "ADVANCE": await advance();    sendResponse({ ok: true }); break;
      case "SNOOZE":  await snooze();     sendResponse({ ok: true }); break;
      case "PAUSE":   await pause();      sendResponse({ ok: true }); break;
      case "RESUME":  await resume();     sendResponse({ ok: true }); break;
      case "SKIP":    await skipToNext(); sendResponse({ ok: true }); break;
      case "RESTART": await start();      sendResponse({ ok: true }); break;
      case "STOP":    await stop();       sendResponse({ ok: true }); break;
      case "SAVE_SETTINGS": {
        await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ...msg.settings } });
        // เริ่มเฟสปัจจุบันใหม่เพื่อใช้ระยะเวลาที่อัปเดต
        const state = await getState();
        if (state.running && !state.paused && !state.awaiting) await enterPhase(state.phase);
        sendResponse({ ok: true });
        break;
      }
      default: sendResponse({ ok: false, error: "unknown message" });
    }
  })();
  return true; // async response
});
