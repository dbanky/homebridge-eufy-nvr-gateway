// Discovering a gateway's cameras for the settings page, and everything about a camera's config
// that follows from the gateway (name, source, branding, audio, video codec), so nobody has to type
// it. Used by the settings page's server (homebridge-ui/server.ts) and at startup (platform.ts).

import type { GatewayConfig } from './gateway.js'
import type { CameraConfig } from './settings.js'

import { DEFAULT_RTSP_PORT, GatewayClient } from './gateway.js'

export const DEFAULT_WEB_PORT = 8099

// What /api/status says about one camera (only the parts used here).
export interface GatewayCameraStatus {
  name: string
  model?: string | null // from the eufy account, e.g. "SoloCam S340" (newer gateways)
  serial: string
  state: string
  battery?: number | null
  resolution?: string
  audio?: string | null
  video?: { codec?: string | null, cameraCodec?: string | null, converted?: boolean, transcode?: boolean, text?: string }
}

export interface GatewayStatus {
  rtspPort?: number
  rtsp?: { login?: boolean }
  gateway?: { version?: string, login?: boolean, streamLoginForApi?: boolean }
  cameras?: GatewayCameraStatus[]
}

// What /api/devices says about one device on the eufy account.
export interface GatewayDevice {
  serial: string
  name?: string
  model?: string
  modelName?: string
}

export interface Branding {
  manufacturer: string
  model: string
  serialNumber: string
  firmwareRevision: string
}

export interface CodecChoice {
  vcodec: 'copy' | 'libx264'
  note: string
}

export interface DiscoveredCamera {
  name: string
  serial: string
  state: string
  battery: number | null
  resolution: string
  audio: boolean // the gateway's stream carries sound
  video: string // the gateway's own description of the stream
  branding: Branding
  codec: CodecChoice
  source: string // the FFmpeg source, password hidden
}

export interface Discovery {
  url: string
  version: string
  rtspPort: number
  rtspLogin: boolean // the streams need a login ("rtsp" in the gateway's config.json)
  cameras: DiscoveredCamera[]
}

// "192.168.1.10", "192.168.1.10:8099", "gateway.local" or a full URL -> "http://192.168.1.10:8099".
export function normalizeGatewayAddress(input: string): string {
  const text = String(input ?? '').trim().replace(/\/+$/, '')
  if (!text) {
    throw new Error('Enter the gateway\'s IP address, e.g. 192.168.1.10')
  }
  const withScheme = /^https?:\/\//i.test(text) ? text : `http://${text}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new Error(`"${input}" is not an IP address or host name`)
  }
  if (url.pathname !== '/' || url.search || url.username) {
    throw new Error(`Enter only the gateway's address (e.g. 192.168.1.10 or 192.168.1.10:8099), not "${input}"`)
  }
  const port = url.port || (/^https?:\/\//i.test(text) ? '' : String(DEFAULT_WEB_PORT))
  return `${url.protocol}//${url.hostname}${port ? `:${port}` : ''}`
}

// HomeKit wants a firmware revision of up to three numbers: "0.5.1-beta.2" -> "0.5.1".
export function firmwareFrom(version?: string): string {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(version ?? ''))
  return match ? match.slice(1).filter(part => part !== undefined).join('.') : '1.0.0'
}

// The model comes with the camera from newer gateways; older ones only have it in /api/devices.
export function brandingFor(camera: Pick<GatewayCameraStatus, 'serial' | 'model'>, devices: GatewayDevice[], version?: string): Branding {
  const device = devices.find(d => d.serial === camera.serial)
  return {
    manufacturer: 'eufy',
    model: camera.model || device?.modelName || device?.model || 'eufy camera',
    serialNumber: camera.serial,
    firmwareRevision: firmwareFrom(version),
  }
}

// "copy" passes the gateway's video to HomeKit as it is (no conversion, almost no CPU). HomeKit
// only plays H.264, so a camera whose stream is or may become H.265 is converted instead.
export function codecFor(camera: Pick<GatewayCameraStatus, 'video'>): CodecChoice {
  const video = camera.video ?? {}
  // "transcode": true on the gateway: its stream is H.264 at one size, always. Gateways before
  // 0.5.2 don't report it; their text says "converted until the camera's format is known" when not.
  const transcoding = video.transcode ?? (!!video.converted && !!video.text && !video.text.includes('until'))
  if (video.codec === 'hevc' || (!transcoding && video.cameraCodec === 'hevc')) {
    return { vcodec: 'libx264', note: 'The gateway streams this camera as H.265, which HomeKit can\'t play: converted to H.264.' }
  }
  if (video.codec === 'h264' && transcoding) {
    return { vcodec: 'copy', note: 'The gateway already converts this camera to H.264 at one fixed size: it goes to HomeKit as it is.' }
  }
  if (video.codec === 'h264' && video.cameraCodec === 'h264') {
    return { vcodec: 'copy', note: 'The camera sends H.264, which goes to HomeKit as it is: no conversion.' }
  }
  return {
    vcodec: 'libx264',
    note: 'The gateway doesn\'t know yet whether this camera sends H.264 or H.265 (it learns that the first time the camera wakes): converted to H.264 to be safe.',
  }
}

const hidePassword = (source: string): string => source.replace(/\/\/([^:@/]+):[^@/]*@/, '//$1:***@')

export async function discover(gateway: GatewayConfig, client?: Pick<GatewayClient, 'status' | 'devices'>): Promise<Discovery> {
  const url = normalizeGatewayAddress(gateway.url ?? '')
  const api = client ?? new GatewayClient({ ...gateway, url })
  const status = await api.status() as GatewayStatus
  // Gateways before 0.6.0 have the models only in the device list (open only without a web login).
  const needDevices = (status.cameras ?? []).some(camera => !camera.model)
  const devices = needDevices ? await api.devices().catch(() => [] as GatewayDevice[]) as GatewayDevice[] : []
  const rtspPort = status.rtspPort || DEFAULT_RTSP_PORT
  const rtspLogin = !!status.rtsp?.login
  const forSource = new GatewayClient({ ...gateway, url, rtspPort })
  return {
    url,
    version: status.gateway?.version ?? '',
    rtspPort,
    rtspLogin,
    cameras: (status.cameras ?? []).map(camera => ({
      name: camera.name,
      serial: camera.serial,
      state: camera.state,
      battery: camera.battery ?? null,
      resolution: camera.resolution ?? '',
      audio: !!camera.audio,
      video: camera.video?.text ?? '',
      branding: brandingFor(camera, devices, status.gateway?.version),
      codec: codecFor(camera),
      source: hidePassword(forSource.ffmpegSource(camera.name)),
    })),
  }
}

// The config of one discovered camera. Keeps what the person chose before (audio, codec, sleep),
// sets everything that follows from the gateway (name, branding), and keeps unknown keys. The
// codec is only stored when chosen: left out, the plugin picks it at startup (codecFor), so it
// follows the gateway when that learns the camera's format later.
export function cameraConfigFor(camera: DiscoveredCamera, previous?: CameraConfig): CameraConfig {
  const previousVideo = { ...previous?.videoConfig }
  delete previousVideo.source // the source follows from the gateway
  return {
    ...previous,
    name: camera.name,
    gatewayCamera: camera.name,
    ...camera.branding,
    sleepWhenStreamEnds: previous?.sleepWhenStreamEnds ?? true,
    videoConfig: {
      ...previousVideo,
      audio: camera.audio ? (previous?.videoConfig?.audio ?? true) : false, // only if the gateway's stream has sound
    },
  }
}
