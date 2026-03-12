# WinSense

WinSense is a desktop controller utility for DualSense on Windows, built with Tauri, React, and TypeScript.

## Features

- Dashboard for quick controller status and profile actions
- Trigger, lighting, calibration, and mapping controls
- Persistent app settings and profiles
- System tray support with startup options

## Screenshots

### Dashboard

![WinSense dashboard](./screenshots/winsense_dashboard.png)

### Mapping

![WinSense mapping](./screenshots/winsense_mapping.png)

### Lighting

![WinSense lighting](./screenshots/winsense_lighting.png)

### Settings

![WinSense settings](./screenshots/winsense_settings.png)

## Development

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

The Windows installer is generated in `src-tauri/target/release/bundle/nsis/`.
