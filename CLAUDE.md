# CLAUDE.md

ไฟล์นี้ให้ context กับ Claude Code เมื่อทำงานในโปรเจกต์นี้ อ่านก่อนแก้ทุกครั้ง

## โปรเจกต์นี้คืออะไร

Chrome Extension (Manifest V3) เตือนให้สลับท่าทาง **นั่ง → ยืน → เดิน** ตามจังหวะ
ergonomics เพื่อสุขภาพหลัง แจ้งเตือนระดับ OS ผ่าน `chrome.notifications`
vanilla JS ล้วน ไม่มี build step / ไม่มี dependency / ไม่มี framework

## กฎเหล็ก (ห้ามทำผิด)

1. **ห้ามใช้ `setInterval` / `setTimeout` ใน `background.js`** — service worker ของ MV3
   ถูก Chrome kill ตอน idle จับเวลาด้วย `chrome.alarms` เท่านั้น
2. **ห้ามเก็บ state ในตัวแปร global ของ service worker** — มันหายเมื่อ worker ถูก kill
   ใช้ `chrome.storage.local` ผ่าน `getState()` / `setState()` เสมอ
3. **อย่าเล่นเสียงตรง ๆ ใน service worker** — MV3 ไม่มี DOM/Audio ต้องผ่าน `chrome.offscreen`
4. **อย่าเพิ่ม permission เกินจำเป็น** ใน `manifest.json` — ตอนนี้มีแค่ `alarms`, `notifications`, `storage`
5. **อย่าใส่ `default_locale`** ถ้าไม่ได้ทำโฟลเดอร์ `_locales/` — Chrome จะ load ไม่ขึ้น

## สถาปัตยกรรม

State machine วนไม่รู้จบ ใน `background.js`:

```
SIT (20m) ──หมดเวลา──▶ [เด้งเตือน รอ user กด] ──▶ STAND (8m) ──▶ ... ──▶ SIT ...
```

**สำคัญ: ไม่ auto-advance** — หมดเวลาเฟสแล้วเข้า state `awaiting` (badge `!`) เด้ง notification +
popup window รอ user กด "เริ่มท่าถัดไป" (`advance()`) ถึงจะเข้าเฟสถัดไปจริง

**Flow:** `enterPhase()` ตั้งเวลา → alarm ยิง → `onPhaseEnd()` (set awaiting + เด้งเตือน) →
user กด → `ADVANCE`/`SNOOZE` → `advance()` เข้าเฟสถัดไป

**Alarms 4 ตัว:**
- `phase-timer` — one-shot ตั้งตอนเข้าเฟสใหม่ ยิงเมื่อหมดเวลา → `onPhaseEnd()` (เด้งเตือน ไม่เปลี่ยนท่าเอง)
- `tick` — ทุก 1 นาที อัปเดต badge นับถอยหลังบนไอคอน
- `resume` — ตั้งตอน snooze เพื่อปลุกมาเตือนเปลี่ยนท่าซ้ำ
- `nag` — repeating ทุก `NAG_MINUTES` (3 นาที) ระหว่าง `awaiting`: เด้งเตือนซ้ำทั้งชุด
  (`renag()`) จนกว่า user จะกด — แก้ bug ค้าง awaiting ทั้งวันถ้าพลาดเตือนครั้งแรก
  ต้อง clear ทุกทางออกจาก awaiting (`advance`/`snooze`/`pause`/`stop`) และสร้างใหม่ใน
  `resume` (สาย awaiting) + `onStartup` (ปิด Chrome ทั้งที่ค้าง awaiting)

**Storage keys:**
- `state` = `{ running, paused, awaiting, phase, nextPhase, phaseEndsAt, cycle }`
- `settings` = `{ durations{SIT,STAND,WALK}, soundEnabled, popupEnabled, snoozeMinutes, workHoursEnabled, startHour, endHour }`
- `alertWindowId` = id หน้าต่าง popup ที่เปิดอยู่ (กันเด้งซ้อน — ล้างเมื่อปิดหน้าต่าง)

**Source of truth อยู่ที่ `background.js`** — UI (popup/options) เป็นแค่หน้าจอ
สื่อสารผ่าน message เท่านั้น ไม่แตะ storage ตรง

## แผนที่ไฟล์

| ไฟล์ | หน้าที่ | แก้เมื่อ |
|---|---|---|
| `manifest.json` | config + permissions | เพิ่ม permission / หน้า / ไอคอน |
| `background.js` | state machine + alarms + notifications + popup window | แก้ logic การเตือนทั้งหมด |
| `popup.{html,css,js}` | หน้าต่างบน toolbar (เฟส + นับถอยหลัง + ปุ่ม) | แก้ UI ควบคุม |
| `alert.{html,css,js}` | หน้าต่าง popup ที่เด้งตอนเปลี่ยนเฟส (ปุ่มลุกแล้ว/เลื่อน) | แก้ UI หน้าต่างเด้ง |
| `options.{html,css,js}` | หน้าตั้งค่า | เพิ่ม/แก้ค่าตั้งค่า |
| `icons/` | 16, 48, 128 | เปลี่ยนไอคอน |

## Message protocol (popup/options → background)

ทุกอย่างผ่าน `chrome.runtime.sendMessage({ type, ... })`:

- `GET_STATE` → คืน `{ state, settings, phases, order }`
- `ADVANCE` (ปุ่มเริ่มท่าถัดไป) / `SNOOZE` (ปุ่มเลื่อน) — จาก popup window
- `PAUSE` / `RESUME` / `SKIP` / `RESTART` / `STOP`
- `SAVE_SETTINGS` → `{ type, settings }`

**ถ้าเพิ่ม action ใหม่:** เพิ่ม case ใน `chrome.runtime.onMessage` listener ของ `background.js`
อย่าทำ logic ซ้ำใน UI

## การ test / reload

ไม่มี build step:
1. แก้ไฟล์
2. `chrome://extensions` → กดปุ่ม reload (🔄) ที่ extension นี้
3. ดู error ที่ลิงก์ **"service worker"** (console ของ background) และคลิกขวาที่ popup → Inspect

ตรวจ syntax เร็ว ๆ: `node --check background.js`
ตรวจ manifest: `python3 -c "import json;json.load(open('manifest.json'))"`

## ระวังตอนแก้

- เปลี่ยน flow เฟส → ต้องอัปเดตทั้ง `PHASES`, `PHASE_ORDER`, และ `advancePhase()`
- `chrome.alarms` ตั้งขั้นต่ำได้ **1 นาที** — นับถอยหลังวินาทีทำที่ฝั่ง popup (มีชีวิตเฉพาะตอนเปิด ใช้ setInterval ได้)
- `requireInteraction: true` ใช้กับเฟส STAND/WALK (`hold: true`) เพื่อบังคับให้เห็น — อย่าเผลอเอาออก
- เวลาแก้ `settings` shape ต้องอัปเดต `DEFAULT_SETTINGS`, `options.js` (collect/load), และ README ให้ตรง

## roadmap (ดู README.md หัวข้อ 5)

สถิติรายวัน · ข้ามวันหยุด · เสียง custom ผ่าน offscreen · ท่ายืดสุ่ม · `chrome.idle` detect AFK

## บริบทผู้ใช้

ผู้ใช้กำลังดูแลอาการปวดหลัง (ทำกายภาพบำบัด) — เครื่องมือนี้มีเป้าหมายสุขภาพจริงจัง
ค่าเริ่มต้น 20-8-2 เป็นแนวทางทั่วไป ถ้าผู้ใช้ระบุจังหวะจากนักกายภาพ ให้ยึดตามนั้น
