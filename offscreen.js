// เล่นเสียงเตือนตอนเปลี่ยนเฟส — MV3 service worker ไม่มี DOM/Audio ต้องผ่านที่นี่
// ใช้ WebAudio สร้าง beep เอง ไม่ต้องมีไฟล์เสียง
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "PLAY_BEEP") return;
  const ctx = new AudioContext();
  // beep สองโน้ตสั้น ๆ (ding-dong) เด่นพอให้ได้ยิน ไม่รำคาญ
  [880, 1175].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    const t = ctx.currentTime + i * 0.18;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.18);
  });
});
