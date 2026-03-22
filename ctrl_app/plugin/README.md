# NSD Discovery Plugin & CtrlApp Webapp

## Overview

A Cordova plugin that uses Android's `NsdManager` to discover mDNS (`_http._tcp.`) services by name, paired with a dark-mode webapp that connects to the discovered service via WebSocket.

---

## Plugin structure

```
ctrl_app/plugin/
├── plugin.xml                          — Cordova manifest
├── www/
│   └── NsdDiscovery.js                 — JS interface (auto-injected by Cordova)
└── src/
    └── android/
        └── NsdDiscoveryPlugin.java     — Android implementation
```

---

## Installation

From `ctrl_app/`, run once after cloning / first setup:

```bash
cordova plugin add ./plugin
cordova build android
```

Cordova reads `plugin.xml` and:
- Copies `NsdDiscoveryPlugin.java` into the platform build tree
- Adds the `<feature name="NsdDiscovery">` tag to `platforms/android/app/src/main/res/xml/config.xml`
- Adds the two required permissions to `AndroidManifest.xml`

---

## Permissions added by the plugin

| Permission | Purpose |
|---|---|
| `CHANGE_WIFI_MULTICAST_STATE` | Required to acquire a `WifiManager.MulticastLock` so mDNS multicast packets are not filtered by the WiFi driver |
| `ACCESS_WIFI_STATE` | Required to obtain the `WifiManager` instance |

---

## JS API

`NsdDiscovery` is available as a global after `deviceready`.

### `NsdDiscovery.startDiscovery(serviceName, onEvent, onError)`

Starts scanning `_http._tcp.` services. Acquires a multicast lock. Streams events back via `onEvent` for the lifetime of discovery — a single `cordova.exec` call with `keepCallback = true`.

| Argument | Type | Description |
|---|---|---|
| `serviceName` | `string` | Exact name to match (e.g. `"AudioAppWS"`) |
| `onEvent` | `function(event)` | Called on `found` and `lost` |
| `onError` | `function(message)` | Called on discovery or resolve failure |

**Event objects:**

```js
// Service found and resolved
{ type: 'found', service: 'AudioAppWS', host: '192.168.x.x', port: 8080 }

// Service went away
{ type: 'lost',  service: 'AudioAppWS', host: '',             port: 0    }
```

### `NsdDiscovery.stopDiscovery([onSuccess, onError])`

Stops scanning and releases the multicast lock. Both callbacks are optional.

---

## Android implementation notes

**`NsdDiscoveryPlugin.java`** extends `CordovaPlugin`.

- On `startDiscovery`: gets `NsdManager` from the system, acquires a multicast lock, registers a `DiscoveryListener` scoped to `_http._tcp.`
- On `onServiceFound`: filters by the exact service name passed from JS, then calls `nsdManager.resolveService()` to obtain the host IP and port
- On resolve success: fires a `found` event back to JS via `sendPluginResult` with `keepCallback = true`
- On `onServiceLost`: fires a `lost` event if the lost service matches the target name
- On `stopDiscovery`: calls `nsdManager.stopServiceDiscovery()` and releases the multicast lock
- `onDestroy()` cleans up automatically when the activity is torn down

---

## Webapp flow

### Screens

| Screen | Shown when |
|---|---|
| **Searching** — pulsing cyan ring | App starts; after disconnect or service lost |
| **Found/Connecting** — spinner | `found` event received; WebSocket opening |
| **Connected** — terminal chat | `ws.onopen` fires |
| **Error** — with Retry button | Discovery error |

### Connection lifecycle

```
deviceready
    └─▶ NsdDiscovery.startDiscovery('AudioAppWS')   [Searching screen]
            └─▶ found event
                    └─▶ new WebSocket('ws://host:port')   [Found screen]
                            └─▶ ws.onopen
                                    └─▶ NsdDiscovery.stopDiscovery()   [Connected screen]
                                    ws.onclose / Disconnect button
                                            └─▶ NsdDiscovery.startDiscovery(...)   [Searching screen]
```

### Chat UI

- Received messages appear in green prefixed with `< `
- Sent messages appear in blue prefixed with `> `
- **Enter** sends; **Shift+Enter** inserts a newline
- Textarea auto-grows up to 120 px
- Disconnect button closes the WebSocket and restarts discovery

### WebSocket

Uses the browser's native `WebSocket` API — no manual frame encoding. The CSP includes `connect-src ws://*` to allow connections to any local IP.

---

## File summary

| File | Role |
|---|---|
| `plugin/plugin.xml` | Cordova plugin manifest — JS module declaration, Java source copy rule, feature registration, permissions |
| `plugin/www/NsdDiscovery.js` | Thin `cordova.exec` wrapper exposing `startDiscovery` and `stopDiscovery` |
| `plugin/src/android/NsdDiscoveryPlugin.java` | Full Android NSD implementation; fires JS events via kept callback |
| `config.xml` | Registers the local plugin (`spec="plugin"`); adds `ws://` to allowed navigations |
| `www/index.html` | Four-screen HTML skeleton; CSP includes `connect-src ws://*` |
| `www/css/index.css` | Dark-mode styles; pulse ring, spinner, terminal chat layout |
| `www/js/index.js` | App logic — starts discovery on `deviceready`, opens WS on found event, handles chat input |
