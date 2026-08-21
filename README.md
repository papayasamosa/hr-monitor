# Heart Rate Monitor

A minimal personal heart-rate recorder, built once as a React/Vite app and shipped two ways from the same codebase:

- **Web** — hosted on GitHub Pages, connects over Web Bluetooth, stores sessions in the browser's IndexedDB.
- **Android** — an installable APK (via [Capacitor](https://capacitorjs.com)) that connects over native Android BLE, keeps recording in the background via a foreground service, and stores sessions in local SQLite.

Every recorded session can be tagged Strength or Cardio, browsed in History, and exported as CSV (`timestamp,elapsed_seconds,heart_rate_bpm,session_type`). No accounts, no cloud sync, no backend — heart-rate data never leaves your device.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Live app (web)

https://papayasamosa.github.io/hr-monitor/

## How it's organized

```
src/
  components/            Shared React UI (Monitor, History, Session Detail, ...)
  services/
    platform.js          Detects web vs. Android (Capacitor.isNativePlatform())
    bluetooth/
      webBluetooth.js     Web Bluetooth (wraps utils/bluetooth.js)
      androidBluetooth.js Native BLE, via the HrRecorder Capacitor plugin
      index.js            Picks the right one at runtime
    storage/
      webStorage.js       IndexedDB
      androidStorage.js   SQLite, via the HrRecorder Capacitor plugin
      index.js
    session/
      sessionModel.js         Shared session/reading shapes + stats helpers
      webSessionRecorder.js   Drives IndexedDB writes directly from React
      androidSessionRecorder.js  Starts/stops the native foreground recording
      index.js
      exportSession.js    CSV export, shared by both platforms
  utils/
    bluetooth.js          Web Bluetooth GATT calls (existing, reused as-is)
    csvExport.js          CSV building/download (platform-agnostic)
    debugBluetooth.js     Dev-only console recorder/playback (window.hrDebug)
android/                  Native Android project (Capacitor + a custom plugin)
  app/src/main/java/com/papayasamosa/hrmonitor/
    HrRecorderPlugin.kt     JS-facing Capacitor plugin
    BleManager.kt           Owns the BluetoothGatt connection
    HrDatabaseHelper.kt     SQLite (sessions + readings)
    HrRecordingService.kt   Foreground service + notification
```

Components never branch on platform directly — they call `services/bluetooth` and `services/storage`/`services/session`, which resolve to the web or Android implementation at runtime. See `src/services/*/index.js`.

---

## Web development

```bash
npm install
npm run dev          # http://localhost:3000
```

Connect a BLE heart-rate monitor, pick a session type, record, and check History — sessions persist in the browser's IndexedDB across reloads. Without hardware, the console exposes a debug playback path:

```js
window.hrDebug.play({
  deviceName: 'Test Device',
  readings: [{ timestamp: 0, heartRate: 80 }, { timestamp: 1000, heartRate: 84 }, /* ... */]
})
```

### Production build

```bash
npm run build         # -> dist/
```

Requires a browser with Web Bluetooth (Chrome, Edge) and HTTPS (or `localhost`). No backend, no Node process at runtime — `dist/` is static HTML/CSS/JS, deployable anywhere, currently on GitHub Pages via `.github/workflows/deploy.yml`.

### Web data & background limits

Sessions and readings live in IndexedDB, written incrementally as each reading arrives (not just held in memory), so a crashed/closed tab loses at most the last unwritten reading — on next load the app finds the orphaned session and marks it "interrupted" rather than losing it. That said, the web version has no background guarantees: browser tab throttling and OS power-saving can pause a background/inactive tab, and there's no equivalent of Android's foreground service. **For screen-off or backgrounded recording during a workout, use the Android app.**

---

## Android development

The Android project lives in `android/` and was added via Capacitor (`npx cap add android`). It uses **native Android BLE**, not Web Bluetooth in a WebView — see `HrRecorderPlugin.kt`.

### A different UI from the web app, same underlying logic

The Android screens (`src/components/android/`) are deliberately not a copy of the web layout — mobile-first, full-width, no desktop-style panels. They share the same session recording/storage/CSV logic as web (`services/*`, `hooks/useRecordingSession.js`) but differ in how connection is handled and presented:

- **No "Connect" button on the home screen.** The app remembers the last device you connected to (`DevicePrefs.kt`, survives app kills) and silently attempts to reconnect on launch. The home screen just shows a compact, tappable status row (Connected / Connecting… / Not connected / No HR monitor configured) — verified end-to-end on a real device: force-killing the app and relaunching reconnects automatically and starts streaming live BPM within a couple of seconds, no user action required.
- Device management (connect a new device, manually reconnect, forget the remembered device) lives in a secondary screen reached by tapping that status row, not on the main screen.
- A live line chart (`HeartRateChart.jsx`, hand-rolled SVG, no charting library) appears while recording and on a saved session's detail screen — it downsamples what it *displays* for long recordings, the stored/exported readings are never reduced.
- A saved session's effective end time can be trimmed earlier (or restored) from its detail screen (`EditEndTimeDialog.jsx`) to cut an accidentally over-recorded tail — non-destructive: the raw readings past the new cutoff stay in SQLite/IndexedDB, just excluded from stats/chart/CSV until restored. Shared between web and Android (`services/session/trimSession.js`, `sessionModel.js`).

### Requirements

- A JDK Gradle 8.14.x actually supports for **running Gradle itself** — JDK 17 or 21 (LTS). **Not JDK 25**: if Android Studio's bundled JBR is JDK 25 (check `<Android Studio install dir>\jbr\release`), Gradle 8.14.3 fails immediately with `Unsupported class file major version 69` — this bit us during setup. Fix: install/point `JAVA_HOME` at a JDK 21 instead (e.g. [Eclipse Temurin 21](https://adoptium.net/temurin/releases/?version=21)); the project's own Java/Kotlin compile targets (`compileOptions`/`kotlinOptions` in `android/app/build.gradle`) are set to 21 to match.
- Android SDK with `platform-tools`, `platforms;android-36`, and `build-tools;36.0.0` installed, and its licenses accepted (`sdkmanager --licenses`). Android Studio's SDK Manager does this for you; from the command line, download the [SDK command-line tools](https://developer.android.com/studio#command-tools) and run `sdkmanager` directly.
- `android/local.properties` with `sdk.dir=<path to your Android SDK>` (gitignored — machine-specific, not committed).
- An Android device or emulator running **Android 8.0 (API 26) or later**.

Set `JAVA_HOME` and `ANDROID_HOME` once (PowerShell, persists for new terminals):

```powershell
[Environment]::SetEnvironmentVariable("JAVA_HOME", "<path to a JDK 17 or 21>", "User")
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "<path to your Android SDK>", "User")
```

(Open a **new** terminal afterward — an already-running shell won't pick up the change.)

### Build commands

```powershell
npm run android:sync            # build web assets + copy them into android/ + sync plugins
npm run android:open            # open the project in Android Studio
npm run android:assembleDebug   # build a debug APK -> android/app/build/outputs/apk/debug/app-debug.apk
npm run android:assembleRelease # build an unsigned release APK
```

These were run end-to-end and verified working in this repo: `npm run android:assembleDebug` produces `android/app/build/outputs/apk/debug/app-debug.apk` (~4.2MB) with `BUILD SUCCESSFUL`. The scripts call `.\gradlew.bat` (Windows-specific — on macOS/Linux use `./gradlew` instead) and need `JAVA_HOME`/`ANDROID_HOME` set as above. Easiest path if you'd rather not manage the SDK yourself: open the project once in Android Studio (`npm run android:open`) and let it configure everything, then build from the IDE (Build → Build Bundle(s)/APK(s) → Build APK(s)) or use the `gradlew` commands afterward from a terminal.

To sideload the debug APK: enable "Install unknown apps" for your file manager/browser on the device, transfer `app-debug.apk`, and open it.

**Signed release APK:** generate a keystore (`keytool -genkey -v -keystore release.keystore -alias hrmonitor -keyalg RSA -keysize 2048 -validity 10000`), configure a `signingConfig` in `android/app/build.gradle` pointing at it, then run `android:assembleRelease`. Play Store publishing is not required or assumed — the release build is for sideloading your own signed build.

### Android permissions

Requested at runtime, only what's needed for the current OS version:

- **Android ≤ 11 (API ≤ 30):** `ACCESS_FINE_LOCATION` (required by the OS for BLE scanning on these versions, even though the app doesn't use location data)
- **Android 12+ (API 31+):** `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT` (declared with `neverForLocation` on the scan permission, so no location permission is requested here)
- **Android 13+ (API 33+):** `POST_NOTIFICATIONS`, so the required recording-in-progress notification can actually show

All are requested lazily, the first time the app actually needs them (an auto-reconnect attempt, or tapping "Connect Monitor" in Device Settings) — not proactively on app launch before there's a reason to ask.

### How background recording works

- `BleManager` (a Kotlin singleton, not tied to any Activity) owns the single `BluetoothGatt` connection and does the actual BLE + SQLite work.
- Pressing Start Recording starts `HrRecordingService`, a foreground service whose only job is to keep the app **process** alive at foreground priority and show the required persistent notification (current BPM, elapsed time, a Stop action). It doesn't hold its own separate BLE connection — the point of the foreground service is that Android won't kill the process for being backgrounded while it's running, so `BleManager`'s existing GATT callback keeps firing and keeps writing rows to SQLite regardless of whether the WebView/Activity is visible.
- Stopping the recording (from the app or the notification's Stop action) tears down the foreground service and finalizes the session in SQLite; the BLE connection itself is untouched, so live BPM keeps working and another recording can start without reconnecting.
- If the process is killed while a recording is active (assuming Android permits — a hard swipe-kill or a long-lived background is not always avoidable), whatever was already written to SQLite is preserved; on next launch the app finds the orphaned "recording" row and finalizes it as "interrupted" from the readings that made it to disk.

### Data storage

Sessions and readings are stored in a local SQLite database (`HrDatabaseHelper.kt`) private to the app — nothing is uploaded. Deleting a session cascades to its readings (`ON DELETE CASCADE`). CSV export reads from the same database the History screen shows, so it works identically for a session that just finished or one reopened from History.

### ⚠️ Verification status

Built and tested on a real physical device (a CooSpo HW9 connected over BLE). Confirmed working end-to-end:

- App installs, launches, renders correctly (no white screen, no crashes)
- Auto-reconnect on a **cold app restart** (force-stopped, not just backgrounded): the remembered device survives the kill, the status row shows "Connecting… <device>", and live BPM (plus real RR-interval data) is streaming within a couple of seconds — no user action
- Device Settings screen: current device/status/battery, Change Device, Forget Device
- Start Recording → foreground notification appears (confirmed via `dumpsys notification`, correct channel/flags/Stop action) → live stats + chart update → Stop Recording → notification disappears
- Session correctly saved to SQLite and shown in History; History → Session Detail renders correctly, including the chart and its empty state
- Edit End Time dialog, including Android's native `datetime-local` picker rendering correctly inside the WebView

One real bug was found and fixed this way (compiling alone couldn't have caught it): the connection status got stuck on "Connecting…" indefinitely even though data was already flowing live, because `readBattery()` was `await`ed *before* marking the connection "connected", and the native battery read had no timeout — if Android's BLE stack silently dropped the read (another GATT operation still in flight), that promise never resolved. Fixed by making the battery read fire-and-forget (never blocks the connection-state transition) and adding a native timeout as a backstop (`BleManager.kt`). Confirmed fixed via logcat: the battery result now arrives independently, well after live HR streaming had already been running for many seconds.

**Not exercised this session** (no reason to expect problems, just not directly observed):
- Screen-off / long-backgrounded recording continuity (the device locked partway through testing, which is exactly the scenario the foreground service is designed for, but I didn't have visual confirmation past that point)
- The "interrupted session" recovery path on a real device (kill mid-recording, reopen) — validated on web via automated tests, and the Android code path mirrors it, but not re-run physically here
- Runtime permission *prompts* specifically (permissions were already granted from earlier testing on this device)

If picking this up again: `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`, then run through the remaining items above on a real device.

---

## Session data model (shared)

```json
{
  "id": "session-uuid",
  "startedAt": "2026-08-21T16:02:14.123Z",
  "endedAt": "2026-08-21T16:49:31.883Z",
  "durationMs": 2837760,
  "deviceName": "COOSPO HW9",
  "sessionType": "cardio",
  "averageHeartRate": 132,
  "minimumHeartRate": 84,
  "maximumHeartRate": 176,
  "readingCount": 2811,
  "status": "completed"
}
```

`status` is `"recording"` while active, `"completed"` after a clean Stop, or `"interrupted"` if the device disconnected mid-recording or the app/tab closed unexpectedly (readings already captured are preserved either way — nothing is silently discarded).

Readings preserve the BLE device's own sampling rate — they're never resampled or averaged before storage or export.

## CSV export

```csv
timestamp,elapsed_seconds,heart_rate_bpm,session_type
2026-08-21T16:02:14.123Z,0.000,84,cardio
2026-08-21T16:02:15.128Z,1.005,85,cardio
```

Filename: `heart-rate-YYYY-MM-DD_HH-MM-SS.csv`, using the session's local start time. Available from the Monitor screen right after a session completes (via History) and from any past session's detail view — CSV export is a separate, on-demand action, not an automatic download when a recording stops.

## HRV

Existing HRV analysis (RMSSD/SDNN from RR intervals, 2-minute test) is preserved, tucked into a collapsible "HRV Analysis (optional)" section beneath the recorder — it's secondary to recording/history/CSV export, per the app's priorities, and unaffected by session type.

## Privacy

No analytics, no crash reporting, no telemetry, no remote API calls carry heart-rate data. Sessions never leave your browser (web) or device (Android) except when you explicitly export/share a CSV file yourself.
