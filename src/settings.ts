import type { ChildProcess } from 'child_process';
import type { PlatformAccessory, PlatformIdentifier, PlatformName, SRTPCryptoSuites } from 'homebridge';
import type { Server, Socket } from 'net';
import { defaultFfmpegPath } from '@homebridge/camera-utils'
import { readFileSync } from 'fs';
import { Type } from 'pick-port';
import type { GatewayConfig } from './gateway.js';

export const PLUGIN_NAME = 'homebridge-eufy-nvr-gateway';

export const PLATFORM_NAME = 'EufyNvrGateway';

export const ffmpegPathString = defaultFfmpegPath as unknown as string

export const defaultPrebufferDuration = 15000
  
export const PREBUFFER_LENGTH = 4000
export const FRAGMENTS_LENGTH = 4000

export interface MqttAction {
  accessory: PlatformAccessory
  active: boolean
  doorbell: boolean
}
export interface AutomationReturn {
  error: boolean
  message: string
  cooldownActive?: boolean
}
export interface FfmpegPlatformConfig {
  platform: PlatformName | PlatformIdentifier
  name?: string
  videoProcessor?: string
  mqtt?: string
  portmqtt?: number
  tlsmqtt?: boolean
  usermqtt?: string
  passmqtt?: string
  porthttp?: number
  localhttp?: boolean
  gateway?: GatewayConfig
  cameras?: Array<CameraConfig>
}

export interface CameraConfig {
  name?: string
  manufacturer?: string
  model?: string
  serialNumber?: string
  firmwareRevision?: string
  motion?: boolean
  doorbell?: boolean
  switches?: boolean
  motionTimeout?: number
  motionDoorbell?: boolean
  mqtt?: MqttCameraConfig
  gatewayCamera?: string // the camera's "name" in the eufy-nvr-gateway's config.json
  wakeOnStream?: boolean // wake the camera while HomeKit streams it (default true)
  eufyModeSwitch?: boolean // the camera's Eufy mode in HomeKit, as a security system (default true)
  eufyModes?: Array<'home' | 'away' | 'disarmed'> // the Eufy modes HomeKit offers (default all three)
  sleepWhenStreamEnds?: boolean // let it sleep as soon as the last HomeKit viewer leaves (default true)
  videoConfig?: VideoConfig
}

export interface VideoConfig {
  source?: string
  stillImageSource?: string
  returnAudioTarget?: string
  maxStreams?: number
  maxWidth?: number
  maxHeight?: number
  maxFPS?: number
  maxBitrate?: number
  forceMax?: boolean
  vcodec?: string
  packetSize?: number
  videoFilter?: string
  encoderOptions?: string
  mapvideo?: string
  mapaudio?: string
  audio?: boolean
  debug?: boolean
  debugReturn?: boolean
  recording?: boolean
  prebuffer?: boolean
}

export interface MqttCameraConfig {
  motionTopic?: string
  motionMessage?: string
  motionResetTopic?: string
  motionResetMessage?: string
  doorbellTopic?: string
  doorbellMessage?: string
}
export interface FfmpegProgress {
  frame: number
  fps: number
  stream_q: number
  bitrate: number
  total_size: number
  out_time_us: number
  out_time: string
  dup_frames: number
  drop_frames: number
  speed: number
  progress: string
}
export interface PrebufferFmp4 {
  atom: MP4Atom
  time: number
}

export interface Mp4Session {
  server: Server
  process: ChildProcess
}

export interface SessionInfo {
    address: string // address of the HAP controller
    ipv6: boolean
  
    videoPort: number
    videoReturnPort: number
    videoCryptoSuite: SRTPCryptoSuites // should be saved if multiple suites are supported
    videoSRTP: Buffer // key and salt concatenated
    videoSSRC: number // rtp synchronisation source
  
    audioPort: number
    audioReturnPort: number
    audioCryptoSuite: SRTPCryptoSuites
    audioSRTP: Buffer
    audioSSRC: number
  }
  
  export interface ResolutionInfo {
    width: number
    height: number
    videoFilter?: string
    snapFilter?: string
    resizeFilter?: string
  }

  export interface MP4Atom {
    header: Buffer
    length: number
    type: string
    data: Buffer
  }
  
  export interface FFMpegFragmentedMP4Session {
    socket: Socket
    cp: ChildProcess
    generator: AsyncGenerator<MP4Atom>
  }

 export interface PickPortOptions {
    type: Type;
    ip?: string;
    minPort?: number;
    maxPort?: number;
    reserveTimeout?: number;
}
  
export function getVersion() {
  const json = JSON.parse(
    readFileSync(
      new URL('../package.json', import.meta.url),
      'utf-8'
    )
  )
  const version = json.version
  return version
}
