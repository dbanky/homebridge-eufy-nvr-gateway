# <img src="https://raw.githubusercontent.com/dbanky/homebridge-eufy-nvr-gateway/main/media/logo.png" alt="" width="48" height="48" align="absmiddle"> Homebridge eufy NVR Gateway

[![npm](https://badgen.net/npm/v/homebridge-eufy-nvr-gateway)](https://www.npmjs.com/package/homebridge-eufy-nvr-gateway)

HomeKit live view for battery-powered eufy cameras, through the
[eufy NVR Gateway](https://github.com/dbanky/eufy-nvr-gateway). Opening a camera in the Home app
wakes it; closing it lets the camera sleep again.

> [!IMPORTANT]
> **This plugin needs the [eufy NVR Gateway](https://github.com/dbanky/eufy-nvr-gateway), which you
> run separately.** The plugin doesn't talk to eufy at all: the gateway logs in to your eufy account,
> keeps an always-on stream for each camera and wakes the cameras; the plugin brings those streams to
> HomeKit. Without a running gateway, the plugin has no cameras to show.
>
> Set up the gateway first (a Docker container, e.g. on a NAS; see its
> [setup in five steps](https://github.com/dbanky/eufy-nvr-gateway#setup-in-five-steps)), make sure
> its web page shows your cameras, then install this plugin.
>
> eufy allows one login per account at a time: if you also keep homebridge-eufy (or the eufy app on
> another device) logged in with the gateway's account, they log each other out. Give the gateway an
> account of its own, with the cameras shared to it
> ([how](https://github.com/dbanky/eufy-nvr-gateway#the-eufy-account-and-its-two-factor-login)).

## What it does

- **Live view wakes the camera.** When the Home app opens a camera, the plugin asks the gateway to
  wake it. The picture appears at once (the gateway's *Waking up* picture) and switches to live video
  when the camera is awake, usually within a few seconds.
- **It stays awake while you watch**, however long, and **sleeps as soon as you're done**, if the
  live view was what woke it. A camera that was already awake (motion, a doorbell press) is left to
  the gateway.
- **The battery in HomeKit.** A battery camera shows its battery level in the Home app, and *Low
  battery* below 15 % (where the gateway lets only the doorbell or live view wake it). Mains-powered
  cameras report no battery and show none. While it charges, from a cable or a solar panel, the Home
  app says *Charging* (eufy NVR Gateway 0.7.0-beta.2 or later). Both are read from the gateway every
  30 seconds.
- **Tiles never wake a camera.** The pictures on the Home app's tiles come from the gateway: the last
  picture while a camera sleeps, the live one while it is awake.
- **Nothing to type but the gateway's address.** The settings page finds the gateway's cameras and
  fills in the rest: names, streams, sound, video format, and the model and serial number shown in
  the Home app.

## Eufy mode in HomeKit

Each camera gets a **security system** in HomeKit that switches its **Eufy mode**, as the eufy app
would (eufy NVR Gateway 0.7.0 or later):

| Home app | Eufy mode |
|---|---|
| Home | Home |
| Away | Away |
| Off | Disarmed |

What each mode does (which triggers record or notify) is set in the eufy app, as always: e.g. set the
camera to record motion only in Away, and switch it with a Home app automation such as *When the last
person leaves home → Away*. The mode belongs to the camera's station, so a camera behind a HomeBase or
doorbell chime shares it with every device on that station. A mode switched in the eufy app or by its
schedule shows in HomeKit within 30 seconds; eufy's Schedule, Custom and Geofencing modes show as Away,
its Off as Off. Per camera, the settings page chooses which of Home, Away and Disarmed the Home app offers (untick
the ones you don't use; the camera's current mode still shows), or turns the security system off
(*Eufy mode in HomeKit*).

## Installation

The gateway (version 0.6.0 or later) must be running and reachable from the Homebridge host: its web
page on port `8099`, its streams on `8554`.

In the Homebridge UI, open *Plugins*, search for `homebridge-eufy-nvr-gateway` and install it. Or,
in the Homebridge terminal:

```sh
npm install homebridge-eufy-nvr-gateway
```

Each release is also attached as a `.tgz` file on the
[releases page](https://github.com/dbanky/homebridge-eufy-nvr-gateway/releases)
(`npm install --save /path/to/homebridge-eufy-nvr-gateway-<version>.tgz`).

## Setup

Open the plugin's settings in the Homebridge UI and enter the gateway's IP address (its port too, if
it isn't `8099`). The page finds the gateway's cameras at once.

**Login.** Only if the gateway has one: its **stream login** (`"rtsp"` in its config.json), the one
your NVR uses. The page asks for it when the gateway needs it. Homebridge plays the streams with it,
and finds and wakes the cameras with it; it never needs the gateway's web page login. This needs
eufy NVR Gateway 0.6.0 or later.

**For each camera** the page shows its name and stream (both follow from the gateway) and fills in
the model and serial number. You choose:

- **Add to HomeKit**: every camera at the first setup; cameras the gateway gets later start off.
- **Sound**: on when the gateway's stream for that camera has sound (`"audio": true` on the gateway).
- **Eufy mode in HomeKit** (on by default): the camera's security system, see
  [Eufy mode in HomeKit](#eufy-mode-in-homekit), with tick boxes for the modes the Home app offers
  (Home, Away, Disarmed).
- **Sleep as soon as live view closes** (on by default): the camera goes back to sleep the moment
  the last Home app viewer leaves, if the live view was what woke it; a camera that was already awake
  is left alone. If motion starts *while* you watch, closing the live view still ends the session,
  which also stops an NVR's recording of it; turn this off if an NVR records the camera and that
  matters to you. Off, the camera sleeps when the gateway's hold time ends (30 seconds by default).
- **Experimental – WIP → Video codec**: *Automatic* passes the gateway's H.264 to HomeKit as it is
  (`copy`, almost no CPU), and converts with `libx264` when the stream is H.265, which HomeKit can't
  play, or when the gateway doesn't know the camera's format yet. It is decided again at every
  Homebridge start.

Press *Save* and restart Homebridge. Then add each camera in the Home app (*Add Accessory*, *More
options…*) with the Homebridge setup code; the cameras are separate accessories.

## Good to know

- **Battery.** Every live view wakes the camera, even below the gateway's `minBatteryPct`, just like
  the wake button on the gateway's web page.
- **The first seconds of a live view** show the *Waking up* picture: a sleeping camera needs a few
  seconds (some models longer) before it sends video.
- **Moving from homebridge-eufy or Camera FFmpeg.** Remove the cameras there, or they appear twice in
  the Home app. Don't run homebridge-eufy with the gateway's eufy account (see above).
- **Too many wrong logins.** After 10 wrong logins from the Homebridge machine within 5 minutes, the
  gateway refuses its logins for 5 minutes; the Homebridge log says so. Correct the login on the
  settings page and wait.
- **No sound in the Home app** with an error about `libfdk_aac` in the log: the FFmpeg that comes with
  the plugin wasn't downloaded. Run `npm rebuild ffmpeg-for-homebridge` in the Homebridge terminal.
- **Startup check.** At every start the log names each camera as found on the gateway, or says what
  is wrong (address, login, or a camera name the gateway doesn't know).

## Settings in config.json

What the settings page writes, for reference:

```json
{
  "platform": "EufyNvrGateway",
  "name": "eufy NVR Gateway",
  "gateway": {
    "url": "http://192.168.1.10:8099",
    "rtspUsername": "protect",
    "rtspPassword": "choose-another-password"
  },
  "cameras": [
    {
      "name": "front-door",
      "gatewayCamera": "front-door",
      "sleepWhenStreamEnds": true,
      "videoConfig": { "audio": true }
    }
  ]
}
```

| Setting | Meaning |
|---|---|
| `gateway.url` | The gateway's web page |
| `gateway.rtspUsername`, `gateway.rtspPassword` | The gateway's stream login (`"rtsp"` in its config.json), if it has one |
| `gateway.rtspPort` | The gateway's RTSP port, if not `8554` |
| `cameras[].gatewayCamera` | The camera's `name` in the gateway's config.json |
| `cameras[].name` | The name in the Home app (the settings page uses the gateway's name) |
| `cameras[].wakeOnStream` | `false`: live view doesn't wake the camera (default `true`) |
| `cameras[].eufyModes` | The Eufy modes the Home app offers for the camera, from `"home"`, `"away"`, `"disarmed"` (default all three) |
| `cameras[].eufyModeSwitch` | `false`: no Eufy mode security system on this camera (default `true`) |
| `cameras[].sleepWhenStreamEnds` | The camera sleeps as soon as the last viewer leaves, if live view woke it (default `true`); `false`: when the gateway's hold time ends |
| `cameras[].videoConfig.audio` | Sound in the Home app |
| `cameras[].videoConfig.vcodec` | `copy` or `libx264`; left out, it is chosen at every start |

The model, serial number and firmware shown in the Home app (`manufacturer`, `model`,
`serialNumber`, `firmwareRevision`) are filled in from the gateway when left out.

## Development

```sh
npm ci
npm test         # vitest
npm run build    # TypeScript into dist/
```

The gateway integration is in `src/gateway.ts` (its API and keeping a camera awake) and
`src/discovery.ts` (what follows from the gateway); the settings page is `src/homebridge-ui/`.
Publishing a GitHub release publishes the package to npm (`.github/workflows/publish.yml`).

## License

Apache License 2.0, see [LICENSE](LICENSE). Based on
[Homebridge Camera FFmpeg](https://github.com/homebridge-plugins/homebridge-camera-ffmpeg) by Khaos
Tian, Sunoo and the Homebridge team; the changes are listed in the [CHANGELOG](CHANGELOG.md).
