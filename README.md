# Heart Rate Monitor

A minimal web application for recording heart-rate sessions to CSV using the Web Bluetooth API. Track heart rate, HRV (Heart Rate Variability), and device statistics from BLE heart rate monitors, and export each recording — tagged as Strength or Cardio — as a CSV file.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Web Bluetooth](https://img.shields.io/badge/Web%20Bluetooth-API-green.svg)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)

## Live app

The deployed HR Monitor is available at:

https://papayasamosa.github.io/hr-monitor/

## Features

- 🫀 Real-time heart rate monitoring via BLE devices
- ⏺️ Record a session and download it as CSV, tagged Strength or Cardio
- 📊 Track current, average, max, and min heart rate
- 📱 Responsive design for mobile and desktop
- 🔒 Secure Web Bluetooth API integration

## Requirements

- A compatible browser with Web Bluetooth support (Chrome, Edge)
- HTTPS connection (or localhost for development) — Web Bluetooth requires a secure context
- BLE heart rate monitor device

### Enabling Web Bluetooth

**Linux & Older Windows Versions:**
1. Open Chrome/Edge browser
2. Navigate to `chrome://flags#enable-experimental-web-platform-features`
3. Enable the "Experimental Web Platform features" flag
4. Restart your browser

**Windows 10/11 (Recent versions) & Android:**
- Web Bluetooth is enabled by default in Chrome/Edge

**Note:** macOS and iOS do not support Web Bluetooth API.

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Start development server:
```bash
npm run dev
```

3. Open browser and navigate to `http://localhost:3000`

4. Click "Connect to HR Monitor" and select your heart rate device

5. Choose a session type (Strength or Cardio), then click "Start Recording"

6. Click "Stop & Download CSV" to end the recording and download it — each row includes the timestamp, elapsed seconds, BPM, and the selected session type

## Building for Production

```bash
npm run build
```

The built files will be in the `dist` folder, ready to deploy to GitHub Pages.

## Future Enhancements

- Heart rate graphing over time
- Workout zone tracking

## Browser Compatibility

This application requires a browser that supports the Web Bluetooth API:
- Chrome 56+
- Edge 79+
- Opera 43+

Note: Firefox and Safari do not currently support Web Bluetooth.
