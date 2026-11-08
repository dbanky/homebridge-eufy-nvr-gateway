# Homebridge eufy NVR Gateway

A special version of [Homebridge Camera FFmpeg](https://github.com/homebridge-plugins/homebridge-camera-ffmpeg)
for battery eufy cameras behind the [eufy-nvr-gateway](https://github.com/dbanky/eufy-nvr-gateway).

> [!IMPORTANT]
> **This plugin needs the [eufy-nvr-gateway](https://github.com/dbanky/eufy-nvr-gateway), which you
> run separately.** The plugin doesn't talk to eufy at all: the gateway logs in to your eufy account,
> keeps each camera's stream and wakes the cameras, and the plugin only brings its streams to HomeKit.
> Without a running gateway, the plugin has no cameras to show.
>
> Set up the gateway first (it is a Docker container, e.g. on a NAS; see its
> [setup in five steps](https://github.com/dbanky/eufy-nvr-gateway#setup-in-five-steps)), make sure
> its web page shows your cameras, then install this plugin and enter the gateway's IP address on its
> settings page.
>
> eufy allows one login per account at a time: if you also keep homebridge-eufy (or the eufy app on
> another device) logged in with the gateway's account, they log each other out. Give the gateway an
> account of its own, with the cameras shared to it
> ([how](https://github.com/dbanky/eufy-nvr-gateway#the-eufy-account-and-its-two-factor-login)).

The gateway gives every camera an always-on RTSP stream without keeping it awake: while the camera
sleeps, the stream shows its last picture. Watching that stream does not wake the camera, so plain
Camera FFmpeg would only ever show the sleeping picture in the Home app. This version does what
homebridge-eufy does:

- **Live view wakes the camera.** When the Home app opens a camera, the plugin asks the gateway to
  wake it. The stream starts at once with the gateway's *Waking up* picture and switches to live
  video when the camera is awake (usually a few seconds).
- **It stays awake while you watch.** While at least one Home app viewer is open, the plugin repeats
  the wake-up every 10 seconds, so the gateway's hold time never runs out.
- **It sleeps when you're done.** After the last viewer leaves, the camera sleeps when the gateway's
  hold time ends (30 s by default), or at once with `sleepWhenStreamEnds`.
- **Snapshots never wake it.** Tiles in the Home app show the gateway's snapshot: the last picture
  while asleep, the live picture while awake.

Cameras without `gatewayCamera` work exactly as in Camera FFmpeg.

## Setup page

In the Homebridge UI, open the plugin's settings and enter the gateway's IP address. The page finds
the gateway's cameras by itself; there is nothing else to type unless the gateway has logins:

- **Gateway web page login**: only if the gateway's page asks for one. The page opens it when needed.
- **Stream login**: shown only when the gateway's streams need one.

For each camera the page shows its name and video source (both follow from the gateway and can't be
changed) and fills in the branding (eufy, the model from the eufy account, the serial number, the
gateway's version). You choose:

- **Add to HomeKit**: on for every camera at the first setup; cameras the gateway gets later start off.
- **Sound**: on when the gateway's stream for that camera has sound (`"audio": true` on the gateway).
- **Sleep as soon as live view closes**: see `sleepWhenStreamEnds` below.
- **Experimental – WIP → Video codec**: *Automatic* by default, which uses `copy` (no conversion,
  almost no CPU) whenever the gateway's stream is H.264, and converts with `libx264` when it is H.265
  or not known yet. It is picked again at every Homebridge start, so it follows the gateway once that
  has learned a camera's format. Choosing `copy` or `libx264` fixes it.

Press *Save* to store it. Cameras set up by hand in the JSON config (without `gatewayCamera`) are
kept as they are.

## Configuration

What the setup page writes, for reference or for editing the JSON config by hand:

```json
{
  "platform": "EufyNvrGateway",
  "gateway": {
    "url": "http://192.168.1.10:8099"
  },
  "cameras": [
    { "name": "front-door", "gatewayCamera": "front-door", "videoConfig": { "audio": true } },
    { "name": "garden", "gatewayCamera": "garden" }
  ]
}
```

Platform settings, under `gateway`:

- `url`: _(Required for gateway cameras)_ The gateway's web page, e.g. `http://192.168.1.10:8099`.
- `username`, `password`: The web page's login, if the gateway has one (`"web"` in its config.json).
- `rtspPort`: The gateway's RTSP port, if not `8554`.
- `rtspUsername`, `rtspPassword`: The streams' login, if the gateway has one (`"rtsp"` in its config.json).

Camera settings:

- `gatewayCamera`: The camera's `name` in the gateway's config.json. With it, `videoConfig.source`
  can be left out: the camera streams from `rtsp://<gateway>:8554/<gatewayCamera>` over TCP.
- `wakeOnStream`: Wake the camera for live view (default `true`).
- `videoConfig.vcodec`: Left out, it is picked at every start from the gateway (`copy` for an H.264
  stream, `libx264` otherwise). `copy` sends the gateway's picture at its own size and bitrate.
- Branding (`manufacturer`, `model`, `serialNumber`, `firmwareRevision`): left out, it is filled in
  from the gateway at startup.
- `sleepWhenStreamEnds`: Let the camera sleep the moment the last viewer leaves, if HomeKit was what
  woke it (default `false`). Off, it sleeps when the gateway's hold time ends; that leaves a session
  started by motion alone, so an NVR recording the same camera keeps its recording.

All other Camera FFmpeg settings work as usual. Notes for gateway cameras:

- HomeKit only plays H.264, while the gateway may pass a camera's own H.265 through: such cameras
  need `libx264`, which *Automatic* picks for them.
- The picture changes size when a camera wakes (the sleeping picture, then the live video, which some
  cameras start at 720p). With `libx264` the plugin fits every frame into the size HomeKit asked for,
  with black bars where the camera's aspect ratio differs; without that, FFmpeg would keep the size
  of the first frame for the whole stream. `copy` passes the size changes on as they are, which is
  safe with `"transcode": true` on the gateway (one fixed size).
- `audio: true` needs `"audio": true` for the camera on the gateway too.
- A camera's battery pays for every live view: each one wakes it, even below the gateway's
  `minBatteryPct`, just like the wake button on the gateway's web page.

## Installation

**Before you start:** the [eufy-nvr-gateway](https://github.com/dbanky/eufy-nvr-gateway) must be
running and reachable from the Homebridge host (its web page on port `8099`, its streams on `8554`),
with your cameras in its `config.json`. This plugin depends on it and does not install it.

**From npm:** in the Homebridge UI, search the *Plugins* tab for `homebridge-eufy-nvr-gateway` and
install it, or run `npm install homebridge-eufy-nvr-gateway` in the Homebridge terminal.

**From a file:** download `homebridge-eufy-nvr-gateway-<version>.tgz` from the
[releases](https://github.com/dbanky/homebridge-eufy-nvr-gateway/releases), or build it yourself:

```sh
npm ci && npm run build && npm pack      # makes homebridge-eufy-nvr-gateway-<version>.tgz
```

Copy the `.tgz` to the Homebridge host (for the Homebridge Docker image: into its `/homebridge`
folder) and install it from the Homebridge terminal:

```sh
npm install --save /homebridge/homebridge-eufy-nvr-gateway-0.1.0.tgz
```

Then restart Homebridge and add the platform `EufyNvrGateway` (the plugin's settings page in the
Homebridge UI shows all options). It can run next to Camera FFmpeg; move a camera over by deleting it
there and adding it here. Its accessories are published like Camera FFmpeg's: add each camera in the
Home app with the Homebridge setup code.

## Development

```sh
npm ci
npm test          # vitest
npm run build     # tsc into dist/
```

The gateway integration is in `src/gateway.ts` (the gateway's HTTP API and the per-camera wake keeper);
`src/streamingDelegate.ts` calls it on stream start and stop and for snapshots, and `src/platform.ts`
derives each gateway camera's source.

---

The rest of this README is Camera FFmpeg's own documentation. Read `Camera-ffmpeg` there as
`EufyNvrGateway`.

# Homebridge Camera FFmpeg

[![npm](https://badgen.net/npm/v/@homebridge-plugins/homebridge-camera-ffmpeg) ![npm](https://badgen.net/npm/dt/@homebridge-plugins/homebridge-camera-ffmpeg)](https://www.npmjs.com/package/@homebridge-plugins/homebridge-camera-ffmpeg) [![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins) [![certified-hoobs-plugin](https://badgen.net/badge/HOOBS/certified/yellow)](https://plugins.hoobs.org/plugin/homebridge-camera-ffmpeg)

[Homebridge](https://homebridge.io) Plugin Providing [FFmpeg](https://www.ffmpeg.org)-based Camera Support

## Installation

This plugin is supported under both [Homebridge](https://homebridge.io) and [HOOBS](https://hoobs.org/). It is highly recommended that you use either [Homebridge Config UI X](https://www.npmjs.com/package/homebridge-config-ui-x) or the HOOBS UI to install and configure this plugin.

### Manual Installation

1. Install this plugin using: `sudo npm install -g homebridge-camera-ffmpeg --unsafe-perm`.
2. Edit `config.json` manually to add your cameras. See below for instructions on that.

## Tested configurations

Other users have been sharing configurations that work for them on our GitHub site. You may want to [check that](https://homebridge-plugins.github.io/homebridge-camera-ffmpeg/configs/) to see if anyone else has gotten your model of camera working already, or [share](https://github.com/homebridge-plugins/homebridge-camera-ffmpeg/issues/new?assignees=&labels=tested+config&template=tested_config.md) a configuration setup that works for you.

## Manual Configuration

### Most Important Parameters

- `platform`: _(Required)_ Must always be set to `Camera-ffmpeg`.
- `name`: _(Required)_ Set the camera name for display in the Home app.
- `source`: _(Required)_ FFmpeg options on where to find and how to decode your camera's video stream. The most basic form is `-i` followed by your camera's URL.
- `stillImageSource`: If your camera also provides a URL for a still image, that can be defined here with the same syntax as `source`. If not set, the plugin will grab one frame from `source`.

#### Config Example

```json
{
  "platform": "Camera-ffmpeg",
  "cameras": [
    {
      "name": "Camera Name",
      "videoConfig": {
        "source": "-i rtsp://username:password@example.com:554",
        "stillImageSource": "-i http://example.com/still_image.jpg",
        "maxStreams": 2,
        "maxWidth": 1280,
        "maxHeight": 720,
        "maxFPS": 30
      }
    }
  ]
}
```

### Optional Parameters

- `motion`: Exposes the motion sensor for this camera. This can be triggered with [dummy switches](https://homebridge-plugins.github.io/homebridge-camera-ffmpeg/automation/switch.html), [MQTT messages](https://homebridge-plugins.github.io/homebridge-camera-ffmpeg/automation/mqtt.html), or [via HTTP](https://homebridge-plugins.github.io/homebridge-camera-ffmpeg/automation/http.html), depending on what features are enabled in the config. (Default: `false`)
- `doorbell`: Exposes the doorbell device for this camera. This can be triggered with [dummy switches](https://homebridge-plugins.github.io/homebridge-camera-ffmpeg/automation/switch.html), [MQTT messages](https://homebridge-plugins.github.io/homebridge-camera-ffmpeg/automation/mqtt.html), or [via HTTP](https://homebridge-plugins.github.io/homebridge-camera-ffmpeg/automation/http.html), depending on what features are enabled in the config. (Default: `false`)
- `switches`: Enables dummy switches to trigger motion and/or doorbell, if either of those are enabled. When enabled there will be an additional switch that triggers the motion or doorbell event. See the project site for [more detailed instructions](https://homebridge-plugins.github.io/homebridge-camera-ffmpeg/automation/switch.html). (Default: `false`)
- `motionTimeout`: The number of seconds after triggering to reset the motion sensor. Set to 0 to disable resetting of motion trigger for MQTT or HTTP. (Default: `1`)
- `motionDoorbell`: Rings the doorbell when motion is activated. This allows for motion alerts to appear on Apple TVs. (Default: `false`)
- `manufacturer`: Set the manufacturer name for display in the Home app. (Default: `Homebridge`)
- `model`: Set the model for display in the Home app. (Default: `Camera FFmpeg`)
- `serialNumber`: Set the serial number for display in the Home app. (Default: `SerialNumber`)
- `firmwareRevision`: Set the firmware revision for display in the Home app. (Default: current plugin version)
- `unbridge`: Bridged cameras can cause slowdowns of the entire Homebridge instance. If unbridged, the camera will need to be added to HomeKit manually. (Default: `true`)

#### Config Example with Manufacturer and Model Set

```json
{
  "platform": "Camera-ffmpeg",
  "cameras": [
    {
      "name": "Camera Name",
      "manufacturer": "ACME, Inc.",
      "model": "ABC-123",
      "serialNumber": "1234567890",
      "firmwareRevision": "1.0",
      "videoConfig": {
        "source": "-i rtsp://username:password@example.com:554",
        "stillImageSource": "-i http://example.com/still_image.jpg",
        "maxStreams": 2,
        "maxWidth": 1280,
        "maxHeight": 720,
        "maxFPS": 30
      }
    }
  ]
}
```

### Optional videoConfig Parameters

- `returnAudioTarget`: _(EXPERIMENTAL - WIP)_ The FFmpeg output command for directing audio back to a two-way capable camera. This feature is still in development and a configuration that works today may not work in the future.
- `maxStreams`: The maximum number of streams that will be allowed at once to this camera. (Default: `2`)
- `maxWidth`: The maximum width used for video streamed to HomeKit. If set to 0, the resolution of the source is used. If not set, will use any size HomeKit requests.
- `maxHeight`: The maximum height used for video streamed to HomeKit. If set to 0, the resolution of the source is used. If not set, will use any size HomeKit requests.
- `maxFPS`: The maximum frame rate used for video streamed to HomeKit. If set to 0, the framerate of the source is used. If not set, will use any frame rate HomeKit requests.
- `maxBitrate`: The maximum bitrate used for video streamed to HomeKit, in kbit/s. If not set, will use any bitrate HomeKit requests.
- `forceMax`: If set, the settings requested by HomeKit will be overridden with any 'maximum' values defined in this config. (Default: `false`)
- `vcodec`: Set the codec used for encoding video sent to HomeKit, must be H.264-based. You can change to a hardware accelerated video codec with this option, if one is available. (Default: `libx264`)
- `audio`: Enables audio streaming from camera. (Default: `false`)
- `packetSize`: If audio or video is choppy try a smaller value, should be set to a multiple of 188. (Default: `1316`)
- `mapvideo`: Selects the stream used for video. (Default: FFmpeg [automatically selects](https://ffmpeg.org/ffmpeg.html#Automatic-stream-selection) a video stream)
- `mapaudio`: Selects the stream used for audio. (Default: FFmpeg [automatically selects](https://ffmpeg.org/ffmpeg.html#Automatic-stream-selection) an audio stream)
- `videoFilter`: Comma-delimited list of additional video filters for FFmpeg to run on the video. If 'none' is included, the default video filters are disabled.
- `encoderOptions`: Options to be passed to the video encoder. (Default: `-preset ultrafast -tune zerolatency` if using libx264)
- `debug`: Includes debugging output from the main FFmpeg process in the Homebridge log. (Default: `false`)
- `debugReturn`: Includes debugging output from the FFmpeg used for return audio in the Homebridge log. (Default: `false`)

#### More Complicated Example

```json
{
  "platform": "Camera-ffmpeg",
  "cameras": [
    {
      "name": "Camera Name",
      "videoConfig": {
        "source": "-i rtsp://myfancy_rtsp_stream",
        "stillImageSource": "-i http://faster_still_image_grab_url/this_is_optional.jpg",
        "maxStreams": 2,
        "maxWidth": 1280,
        "maxHeight": 720,
        "maxFPS": 30,
        "maxBitrate": 200,
        "vcodec": "h264_omx",
        "audio": false,
        "packetSize": 188,
        "hflip": true,
        "additionalCommandline": "-x264-params intra-refresh=1:bframes=0",
        "debug": true
      }
    }
  ]
}
```

### Camera MQTT Parameters

- `motionTopic`: The MQTT topic to watch for motion alerts.
- `motionMessage`: The message to watch for to trigger motion alerts. Will use the name of the camera if blank.
- `motionResetTopic`: The MQTT topic to watch for motion resets.
- `motionResetMessage`: The message to watch for to trigger motion resets. Will use the name of the camera if blank.
- `doorbellTopic`: The MQTT topic to watch for doorbell alerts.
- `doorbellMessage`: The message to watch for to trigger doorbell alerts. Will use the name of the camera if blank.

#### Camera MQTT Example

```json
{
  "platform": "Camera-ffmpeg",
  "cameras": [
    {
      "name": "Camera Name",
      "videoConfig": {
        "source": "-i rtsp://myfancy_rtsp_stream"
      },
      "mqtt": {
        "motionTopic": "home/camera",
        "motionMessage": "ON",
        "motionResetTopic": "home/camera",
        "motionResetMessage": "OFF",
        "doorbellTopic": "home/doobell",
        "doorbellMessage": "ON"
      }
    }
  ]
}
```

### Automation Parameters

- `mqtt`: Defines the hostname or IP of the MQTT broker to connect to for MQTT-based automation. If not set, MQTT support is not started. See the project site for [more information on using MQTT](https://homebridge-plugins.github.io/homebridge-camera-ffmpeg/automation/mqtt.html).
- `portmqtt`: The port of the MQTT broker. (Default: `1883`)
- `tlsmqtt`: Use TLS to connect to the MQTT broker. (Default: `false`)
- `usermqtt`: The username used to connect to your MQTT broker. If not set, no authentication is used.
- `passmqtt`: The password used to connect to your MQTT broker. If not set, no authentication is used.
- `porthttp`: The port to listen on for HTTP-based automation. If not set, HTTP support is not started. See the project site for [more information on using HTTP](https://homebridge-plugins.github.io/homebridge-camera-ffmpeg/automation/http.html).
- `localhttp`: Only allow HTTP calls from localhost. Useful if using helper plugins that translate to HTTP. (Default: `false`)

#### Automation Example

```json
{
  "platform": "Camera-ffmpeg",
  "mqtt": "127.0.0.1",
  "porthttp": "8080",
  "cameras": []
}
```

### Rarely Needed Parameters

- `videoProcessor`: Defines which video processor is used to decode and encode videos, must take the same parameters as FFmpeg. Common uses would be `avconv` or the path to a custom-compiled version of FFmpeg. If not set, will use the included version of FFmpeg, or the version of FFmpeg installed on the system if no included version is available.

#### Rare Option Example

```json
{
  "platform": "Camera-ffmpeg",
  "videoProcessor": "/usr/bin/ffmpeg",
  "cameras": []
}
```

## Credit

Homebridge Camera FFmpeg is based on code originally written by [Khaos Tian](https://twitter.com/khaost).
