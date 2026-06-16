// หน้าต่าง popup ที่เด้งตอน "หมดเวลา" — บอกท่าถัดไป + ปุ่มเริ่ม/เลื่อน
const $ = (id) => document.getElementById(id);

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

function hintFor(key) {
  return {
    SIT:   "นั่งหลังตรง เท้าแตะพื้น จออยู่ระดับสายตา",
    STAND: "ยืนทำงานต่อ ลงน้ำหนักสองขาเท่ากัน",
    WALK:  "เดินสัก 2 นาที หรือยืดหลัง–คอ–ไหล่",
  }[key] || "";
}

async function load() {
  const { state, settings, phases } = await send("GET_STATE");
  const nextKey = state.nextPhase || state.phase;
  const next = phases[nextKey] || phases.SIT;

  document.documentElement.style.setProperty("--accent", next.color);
  $("emoji").textContent = next.emoji;
  $("label").textContent = `ถึงเวลา${next.label}`;
  $("hint").textContent = hintFor(next.key);
  $("time").textContent = `หมดเวลาเฟสที่แล้ว — กดปุ่มเพื่อเริ่ม${next.label}`;
  $("ack").textContent = `เริ่ม${next.label} →`;
  $("snooze").textContent = `เลื่อน ${settings.snoozeMinutes} นาที`;
}

$("ack").addEventListener("click", async () => {
  await send("ADVANCE");
  window.close();
});
$("snooze").addEventListener("click", async () => {
  await send("SNOOZE");
  window.close();
});

load();
