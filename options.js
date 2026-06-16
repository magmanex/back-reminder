const $ = (id) => document.getElementById(id);

const FIELDS = {
  durSIT:   ["durations", "SIT"],
  durSTAND: ["durations", "STAND"],
  durWALK:  ["durations", "WALK"],
  soundEnabled:     ["soundEnabled"],
  popupEnabled:     ["popupEnabled"],
  snoozeMinutes:    ["snoozeMinutes"],
  workHoursEnabled: ["workHoursEnabled"],
  startHour:        ["startHour"],
  endHour:          ["endHour"],
};

async function load() {
  const { settings } = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  $("durSIT").value   = settings.durations.SIT;
  $("durSTAND").value = settings.durations.STAND;
  $("durWALK").value  = settings.durations.WALK;
  $("soundEnabled").checked     = settings.soundEnabled;
  $("popupEnabled").checked     = settings.popupEnabled;
  $("snoozeMinutes").value      = settings.snoozeMinutes;
  $("workHoursEnabled").checked = settings.workHoursEnabled;
  $("startHour").value = settings.startHour;
  $("endHour").value   = settings.endHour;
}

function collect() {
  return {
    durations: {
      SIT:   clampInt($("durSIT").value, 1, 120),
      STAND: clampInt($("durSTAND").value, 1, 120),
      WALK:  clampInt($("durWALK").value, 1, 120),
    },
    soundEnabled:     $("soundEnabled").checked,
    popupEnabled:     $("popupEnabled").checked,
    snoozeMinutes:    clampInt($("snoozeMinutes").value, 1, 60),
    workHoursEnabled: $("workHoursEnabled").checked,
    startHour:        clampInt($("startHour").value, 0, 23),
    endHour:          clampInt($("endHour").value, 0, 23),
  };
}

function clampInt(v, min, max) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1600);
}

$("save").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: collect() });
  toast("บันทึกแล้ว ✓");
});

$("restart").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: collect() });
  await chrome.runtime.sendMessage({ type: "RESTART" });
  toast("เริ่มรอบใหม่แล้ว ✓");
});

load();
