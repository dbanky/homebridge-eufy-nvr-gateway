# Changelog

All notable changes to this project. Versions follow [Semantic Versioning](https://semver.org/).
This plugin is based on [Homebridge Camera FFmpeg](https://github.com/homebridge-plugins/homebridge-camera-ffmpeg)
4.1.0; its own history is in [its changelog](https://github.com/homebridge-plugins/homebridge-camera-ffmpeg/blob/latest/CHANGELOG.md).

## [0.4.0-alpha.1] - 2026-11-09

A pre-release for testing, with eufy NVR Gateway
[0.7.0-alpha.1](https://github.com/dbanky/eufy-nvr-gateway/releases/tag/v0.7.0-alpha.1). Not yet
tried on real cameras: please report how switching modes works on yours. Install it with
`npm install homebridge-eufy-nvr-gateway@next` (or `@0.4.0-alpha.1`) in the Homebridge terminal;
normal updates stay on 0.3.3.

### Added

- **The eufy mode in HomeKit.** Each camera gets a security system whose Home, Away and Off switch
  the camera's eufy mode to Home, Away and Disarmed, through the gateway and the eufy SDK, as the eufy
  app would (eufy NVR Gateway 0.7.0 or later). What each mode does stays set in the eufy app. A mode
  switched in the eufy app shows in HomeKit within 30 seconds, and the Devices tab shows it too.
  *eufy mode in HomeKit* on the settings page turns it off per camera.

## [0.3.3] - 2026-11-08

### Changed

- The settings page drops two headings that repeated the window's own title: the "eufy NVR
  Gateway for HomeKit" text under the logo, and "eufy NVR Gateway" above the gateway's address.

## [0.3.2] - 2026-11-08

### Fixed

- **The log says what a stream really is.** With the video passed through (`copy`), it said
  "native x native, native fps, ??? kbps". It now names the gateway's stream, e.g.
  "2048 x 1536 H.264 from the gateway, passed through (no conversion), sound AAC-ELD", from what
  the gateway reported at startup: nothing extra is probed or asked for each stream. Converted
  streams give their size, frame rate and bitrate.

## [0.3.1] - 2026-11-08

### Fixed

- **The camera settings showed under every tab** of the plugin's settings (Devices and Support
  too), because the page closed its Settings section too early. Each tab now shows only its own
  content: Devices just the list of cameras.

## [0.3.0] - 2026-11-08

### Changed

- **Only the stream login.** The web page login is gone from the settings page and the settings:
  Homebridge logs in to the gateway with its stream login alone, which needs eufy NVR Gateway 0.6.0
  or later. Saving the settings once removes a web login that 0.2.0 stored.
- **Sleep as soon as live view closes is on by default** for cameras added from now on: the
  camera goes back to sleep the moment you close its live view, if the live view woke it. Cameras
  already set up keep their setting (earlier versions saved it as off): turn it on in the settings.

### Fixed

- **The Devices tab lists the cameras.** It said "No Devices", because Homebridge keeps no cache
  of HomeKit cameras (they are separate accessories). It now shows each camera added to HomeKit with
  what the gateway says about it right now: asleep, waking or live, battery, model, serial number,
  firmware and video; with the saved details only when the gateway can't be reached.
- The switches on the settings page have space between the switch and its text, and the camera
  cards don't touch: the page now uses the Homebridge UI's own styles (Bootstrap 5).

## [0.2.0] - 2026-11-08

### Changed

- **Homebridge uses the gateway's stream login, not its web page login.** The stream login (the
  one your NVR uses) now also finds and wakes the cameras, so Homebridge no longer needs or stores
  the gateway's admin login. This needs eufy NVR Gateway 0.6.0 or later; older gateways still work
  with the web login, which the settings page asks for only then.
- The model shown in the Home app comes with each camera from the gateway, where the gateway
  reports it.
- The settings page shows the eufy NVR Gateway logo, and its support page links to this plugin and
  the gateway.
- The README only covers what a gateway user needs; Camera FFmpeg's documentation site is gone
  from the repository.

## [0.1.1] - 2026-11-08

### Changed

- Published to npm: install it from the Homebridge UI's plugin search. Every release is published
  by the repository's workflow, with npm provenance.
- The package no longer contains the compiled tests.

## [0.1.0] - 2026-11-08

The first release: Camera FFmpeg for battery eufy cameras behind the
[eufy-nvr-gateway](https://github.com/dbanky/eufy-nvr-gateway), which must run separately.

### Added

- **Live view wakes the camera.** Opening a camera in the Home app asks the gateway to wake it; the
  stream starts at once with the gateway's *Waking up* picture and switches to live video when the
  camera is awake. While anyone watches, the wake-up is repeated so the gateway's hold time never
  runs out; afterwards the camera sleeps when that hold time ends, or at once with
  `sleepWhenStreamEnds`. A session the gateway ended by itself (no picture, offline, `maxLiveMs`)
  is not restarted until the next live view.
- **Snapshots that never wake a camera**, from the gateway: the last picture while asleep, the live
  one while awake.
- **A setup page that finds the gateway's cameras** from its IP address. Name, video source and
  branding (eufy, model, serial number, firmware) follow from the gateway and are filled in
  automatically; sound is on when the gateway's stream has it. Only the logins, which cameras to add,
  sound, sleep and the video codec are left to choose.
- **Automatic video codec:** `copy` (no conversion) whenever the gateway's stream is H.264,
  `libx264` when it is H.265 or not known yet, decided again at every start.
- With `libx264`, every frame is fitted into the size HomeKit asked for, so the picture can change
  size when the camera wakes.
- A check at startup that reports a wrong gateway address, login or camera name, and fills in
  branding the config leaves out.
- The gateway's web login (HTTP Basic) and stream login are supported; a lockout after too many
  wrong logins is explained in the log.

### Changed

- The plugin is `homebridge-eufy-nvr-gateway` with the platform `EufyNvrGateway`, so it can be
  installed next to Camera FFmpeg. Cameras without `gatewayCamera` work as in Camera FFmpeg 4.1.0.
