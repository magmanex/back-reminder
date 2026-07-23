# Posture Break — Chrome Extension

เตือนให้สลับท่าทาง **นั่ง → ยืน → เดิน** ตามจังหวะ ergonomics เพื่อสุขภาพหลัง
แจ้งเตือนระดับ OS (เด้งนอกหน้าต่าง Chrome) ผ่าน `chrome.notifications`

> สร้างมาเพื่อใช้จริงระหว่างทำงานหน้าคอม โดยเฉพาะช่วงที่กำลังดูแล/รักษาอาการปวดหลัง

---

## 1. แนวคิด (Spec)

วงจรทำงานเป็น **state machine** วนไม่รู้จบ:

```
SIT (20 นาที) ──▶ STAND (8 นาที) ──▶ WALK (2 นาที) ──▶ SIT ...
```

ค่าตั้งต้นคือ **กฎ 20-8-2** (รอบละ 30 นาที) ปรับได้ในหน้า Settings

เมื่อถึงเวลาเปลี่ยนเฟส:
- เด้ง notification ระดับ OS บอกว่า "ตอนนี้ต้องทำอะไร" + ใช้เวลากี่นาที
- เฟส STAND / WALK ตั้ง `requireInteraction: true` → ค้างไว้จนกดรับทราบ เพื่อบังคับให้เห็นจริง
- เฟส SIT เด้งแบบหายเองได้

ปุ่มบน notification: **รับทราบ** | **เลื่อน N นาที** (snooze)

---

## 2. โครงสร้างไฟล์

```
back-reminder/
├── manifest.json      # MV3 config (permissions: alarms, notifications, storage)
├── background.js      # service worker — หัวใจ state machine + alarms
├── popup.html/css/js  # หน้าต่างเล็กบน toolbar: เฟสปัจจุบัน + นับถอยหลัง + ปุ่มควบคุม
├── alert.html/css/js  # หน้าต่าง popup ที่เด้งจริงตอนเปลี่ยนเฟส (กันพลาด notification)
├── options.html/css/js# หน้าตั้งค่า: ระยะเวลาเฟส / เสียง / popup / snooze / ช่วงเวลาทำงาน
└── icons/             # 16, 48, 128
```

---

## 3. สถาปัตยกรรมเทคนิค (จุดที่ห้ามพลาดใน MV3)

| ประเด็น | วิธีที่ใช้ | เหตุผล |
|---|---|---|
| ตั้งเวลา | `chrome.alarms` เท่านั้น | service worker ถูก kill ตอน idle → `setInterval` จะหยุดทำงานเอง |
| เก็บ state | `chrome.storage.local` | worker ไม่มี memory ถาวร ต้องกู้คืนเมื่อถูกปลุก |
| alarm ขั้นต่ำ | 1 นาที | Chrome จำกัด periodInMinutes ขั้นต่ำ ดังนั้นนับถอยหลังละเอียดทำที่ฝั่ง popup |
| ถูกปลุกตอนเปิด Chrome | `onStartup` กู้ badge + ถ้าเลยเวลาเฟสให้ advance | กันกรณีปิด Chrome ไว้นาน |

**Alarms ที่ใช้:**
- `phase-timer` — one-shot ตั้งตอนเข้าเฟสใหม่ ยิงเมื่อหมดเวลาเฟส → เด้งเตือน (ไม่เปลี่ยนท่าเอง รอ user กด)
- `tick` — ทุก 1 นาที อัปเดต badge นับถอยหลังบนไอคอน
- `resume` — ตั้งตอน snooze เพื่อปลุกกลับ

**Badge** บนไอคอน toolbar = นาทีที่เหลือ + สีตามเฟส (ฟ้า/เหลือง/เขียว), `⏸` ตอนพัก

**Popup window** — พอหมดเวลาเฟส (ไม่เปลี่ยนท่าเอง) ถ้า `popupEnabled` เปิด (ค่าตั้งต้น) จะเด้ง
หน้าต่างจริงผ่าน `chrome.windows.create({ type: "popup" })` โฟกัสขึ้นมาเลย บอกท่าถัดไป
พร้อมปุ่ม **"เริ่ม<ท่าถัดไป>"** (`advance` → เข้าเฟสถัดไป) และ **"เลื่อน"** (snooze เตือนซ้ำ)
เด้งเฉพาะในช่วงเวลาทำงาน เก็บ window id ใน `chrome.storage.local` (`alertWindowId`) กันเด้งซ้อน
ไม่ต้องขอ permission เพิ่ม คู่กับ OS notification (ปุ่มเดียวกัน) เผื่อ user ไม่เห็นอันใดอันหนึ่ง

กด **ทดสอบแจ้งเตือน** ใน toolbar popup เพื่อยิงเสียง + OS notification + หน้าต่างเตือนทันที
โดยไม่สนช่วงเวลาทำงาน ใช้แยกปัญหาสิทธิ์ notification ของระบบได้

---

## 4. ติดตั้ง / ลองใช้

1. เปิด `chrome://extensions`
2. เปิด **Developer mode** (มุมขวาบน)
3. กด **Load unpacked** → เลือกโฟลเดอร์ `back-reminder/`
4. ปักหมุดไอคอนไว้บน toolbar → จะเริ่มจับเวลาทันที

> ⚠️ ทำงานเฉพาะตอน Chrome เปิดอยู่ ถ้าปิด Chrome หมด extension จะหยุด
> ถ้าต้องการเตือนแบบไม่ขึ้นกับ browser (always-on-top, รันตอน boot) → เวอร์ชัน Tauri จะตอบโจทย์กว่า

---

## 5. แนวทางต่อยอด (สำหรับป้อน Claude Code ทำต่อ)

ลำดับที่แนะนำ ทำทีละข้อ:

- [ ] **สถิติรายวัน** — นับว่าทำครบกี่รอบ/วัน เก็บใน storage แสดงใน popup + กราฟ 7 วันใน options
- [ ] **ข้ามวันหยุด** — ตั้งวันที่ไม่เตือน (เสาร์–อาทิตย์)
- [ ] **เสียงเตือนของตัวเอง** — เล่นไฟล์เสียงผ่าน offscreen document (MV3 เล่นเสียงใน service worker ไม่ได้ ต้องใช้ `chrome.offscreen`)
- [ ] **ท่ายืดแบบสุ่ม** — เฟส WALK สุ่มท่ายืดหลัง/คอ/ไหล่มาแสดงใน notification (อิงคำแนะนำจากนักกายภาพ)
- [ ] **detect idle** — ใช้ `chrome.idle` หยุดเตือนอัตโนมัติเมื่อ AFK และเริ่มใหม่เมื่อกลับมา
- [ ] **ปุ่มเริ่ม/หยุดถาวร** — ปัจจุบันเริ่มอัตโนมัติตอนติดตั้ง อาจเพิ่มปุ่ม Start/Stop ใน popup

### หมายเหตุสำหรับ Claude Code
- โค้ดทั้งหมดเป็น vanilla JS ไม่มี build step — แก้แล้วกด reload ที่ `chrome://extensions` ได้เลย
- รัน regression tests ด้วย `node --test test/background.test.js`
- ทุก feature ที่แตะ state ให้ผ่าน `getState()/setState()` ใน `background.js` และสื่อสารกับ UI ผ่าน message types (`GET_STATE`, `PAUSE`, `RESUME`, `SKIP`, `RESTART`, `SAVE_SETTINGS`)
- อย่าใช้ `setInterval` ใน background.js — ใช้ `chrome.alarms` เสมอ

---

## 6. ข้อควรระวังด้านสุขภาพ

ตัวเลขตั้งต้น (20-8-2) เป็นแนวทางทั่วไป ถ้ามีนักกายภาพบำบัดดูแลอยู่
ให้ยึดจังหวะและท่าที่เขาแนะนำเป็นหลัก แล้วปรับค่าในหน้า Settings ให้ตรงกัน
