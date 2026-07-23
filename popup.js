// popup เป็นหน้าเว็บปกติ มีชีวิตอยู่เฉพาะตอนเปิด — ใช้ setInterval นับวินาทีได้
const RING_LEN = 326.7; // 2 * pi * 52
let cache = null;        // { state, settings, phases, order }
let ticker = null;

const $ = (id) => document.getElementById(id);

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

async function load() {
  cache = await send("GET_STATE");
  render();
  if (ticker) clearInterval(ticker);
  ticker = setInterval(paintTime, 1000);
}

function render() {
  const { state, settings, phases, order } = cache;
  // ระหว่างรอเปลี่ยนท่า โชว์ท่าถัดไป
  const shownKey = state.awaiting ? (state.nextPhase || state.phase) : state.phase;
  const phase = phases[shownKey] || phases.SIT;

  document.documentElement.style.setProperty("--accent", phase.color);
  document.body.classList.toggle("paused", state.paused);
  document.body.classList.toggle("awaiting", state.awaiting);

  $("emoji").textContent = phase.emoji;
  if (state.awaiting) {
    $("phaseLabel").textContent = `ถึงเวลา${phase.label}`;
    $("phaseHint").textContent = hintFor(phase.key);
    $("skip").textContent = `เริ่ม${phase.label}`; // ปุ่มซ้าย = เริ่มท่าถัดไป
  } else {
    $("phaseLabel").textContent = state.paused ? "พักการเตือนอยู่" : phase.label;
    $("phaseHint").textContent = state.paused ? "" : hintFor(phase.key);
    $("skip").textContent = "ข้ามเฟส";
  }
  $("toggle").textContent = state.paused ? "▶" : "⏸";
  $("toggle").title = state.paused ? "ทำต่อ" : "หยุดพัก";
  $("cycle").textContent = state.running ? `รอบที่ ${state.cycle + 1}` : "ยังไม่เริ่ม";
  $("status").textContent = statusText(state, settings);
  $("phases").innerHTML = order.map((key) => {
    const item = phases[key];
    const active = key === shownKey ? " active" : "";
    return `<div class="phase-chip${active}">
      <span>${item.emoji}</span>
      <strong>${shortLabel(key)}</strong>
      <small>${settings.durations[key]} นาที</small>
    </div>`;
  }).join("");

  paintTime();
}

function shortLabel(key) {
  return { SIT: "นั่ง", STAND: "ยืน", WALK: "เดิน" }[key] || key;
}

function statusText(state, settings) {
  if (state.paused) return "หยุดพักการเตือน";
  if (state.awaiting) return "รอคุณเปลี่ยนท่า";
  if (settings.workHoursEnabled) {
    const hour = new Date().getHours();
    const inHours = settings.startHour <= settings.endHour
      ? hour >= settings.startHour && hour < settings.endHour
      : hour >= settings.startHour || hour < settings.endHour;
    if (!inHours) {
      return `โหมดเงียบ · ${padHour(settings.startHour)}–${padHour(settings.endHour)}`;
    }
  }
  return "กำลังจับเวลา";
}

function padHour(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function hintFor(key) {
  return {
    SIT:   "นั่งหลังตรง เท้าแตะพื้น จออยู่ระดับสายตา",
    STAND: "ยืนทำงานต่อ ลงน้ำหนักสองขาเท่ากัน",
    WALK:  "เดินสัก 2 นาที หรือยืดหลัง–คอ–ไหล่",
  }[key] || "";
}

function paintTime() {
  if (!cache) return;
  const { state, settings } = cache;
  const ring = $("ringFg");

  if (!state.running) {
    $("time").textContent = "--:--";
    ring.style.strokeDashoffset = RING_LEN;
    return;
  }

  const total = (settings.durations[state.phase] || 1) * 60000;
  let remain = state.phaseEndsAt - Date.now();
  if (state.paused) remain = state.remainMs != null ? state.remainMs : total; // หยุดพัก: freeze เวลาที่เหลือ
  remain = Math.max(0, remain);

  const sec = Math.ceil(remain / 1000);
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  $("time").textContent = `${mm}:${ss}`;

  const frac = Math.min(1, remain / total);
  ring.style.strokeDashoffset = RING_LEN * (1 - frac);
}

// ---- ปุ่ม ----
$("toggle").addEventListener("click", async () => {
  await send(cache.state.paused ? "RESUME" : "PAUSE");
  await load();
});
$("skip").addEventListener("click", async () => {
  await send("SKIP");
  await load();
});
$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("testAlert").addEventListener("click", async () => {
  const button = $("testAlert");
  button.disabled = true;
  button.textContent = "ส่งแล้ว ✓";
  await send("TEST_ALERT");
  setTimeout(() => {
    button.disabled = false;
    button.textContent = "ทดสอบแจ้งเตือน";
  }, 1400);
});

load();
