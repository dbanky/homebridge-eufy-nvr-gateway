# Changelog

All notable changes to this project. Versions follow [Semantic Versioning](https://semver.org/).
This plugin is based on [Homebridge Camera FFmpeg](https://github.com/homebridge-plugins/homebridge-camera-ffmpeg)
4.1.0; its own history is in [its changelog](https://github.com/homebridge-plugins/homebridge-camera-ffmpeg/blob/latest/CHANGELOG.md).

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
