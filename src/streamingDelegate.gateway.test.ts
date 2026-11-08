import type { API, HAP, PlatformAccessory } from 'homebridge'

import type { CameraConfig, SessionInfo } from './settings.js'
import type { GatewayCamera } from './streamingDelegate.js'

import { Buffer } from 'node:buffer'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { StreamingDelegate } from './streamingDelegate.js'

const ffmpegRuns: string[] = []

vi.mock('@homebridge/camera-utils', () => ({ defaultFfmpegPath: '/usr/bin/ffmpeg' }))
vi.mock('./ffmpeg.js', () => ({
  FfmpegProcess: vi.fn().mockImplementation((_name: string, _id: string, _path: string, args: string) => {
    ffmpegRuns.push(args)
    return { stop: vi.fn(), stdin: { end: vi.fn() } }
  }),
}))
vi.mock('node:dgram', () => ({
  createSocket: () => ({ on: vi.fn(), bind: vi.fn(), close: vi.fn() }),
}))
vi.mock('homebridge', () => ({
  APIEvent: { SHUTDOWN: 'shutdown' },
  AudioRecordingCodecType: { AAC_LC: 0 },
  AudioRecordingSamplerate: { KHZ_32: 32000 },
  AudioStreamingCodecType: { AAC_ELD: 2, OPUS: 3 },
  AudioStreamingSamplerate: { KHZ_16: 16000 },
  StreamRequestTypes: { START: 'start', RECONFIGURE: 'reconfigure', STOP: 'stop' },
}))

const hap = {
  CameraController: vi.fn().mockImplementation(() => ({ forceStopStreamingSession: vi.fn() })),
  SRTPCryptoSuites: { AES_CM_128_HMAC_SHA1_80: 0 },
  H264Profile: { BASELINE: 0, MAIN: 1, HIGH: 2 },
  H264Level: { LEVEL3_1: 0, LEVEL3_2: 1, LEVEL4_0: 2 },
  VideoCodecType: { H264: 0 },
  EventTriggerOption: { MOTION: 0, DOORBELL: 1 },
} as unknown as HAP

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any
const api = { on: vi.fn() } as unknown as API

const sessionInfo: SessionInfo = {
  address: '192.168.1.50',
  ipv6: false,
  videoPort: 50000,
  videoReturnPort: 50001,
  videoCryptoSuite: 0 as any,
  videoSRTP: Buffer.alloc(30),
  videoSSRC: 1,
  audioPort: 50002,
  audioReturnPort: 50003,
  audioCryptoSuite: 0 as any,
  audioSRTP: Buffer.alloc(30),
  audioSSRC: 2,
}

function startRequest(sessionID: string) {
  return ({
    type: 'start',
    sessionID,
    video: { width: 1920, height: 1080, fps: 30, max_bit_rate: 2000, pt: 99, rtcp_interval: 1 },
    audio: { codec: 2, sample_rate: 16, max_bit_rate: 24, channel: 1, pt: 110 },
  }) as any
}

function gatewayCamera(): GatewayCamera & { client: any } {
  return {
    client: {
      wake: vi.fn(async () => 'WAKING'),
      sleep: vi.fn(async () => 'IDLE'),
      state: vi.fn(async () => 'IDLE'),
      snapshot: vi.fn(async () => Buffer.from('jpeg')),
    } as any,
    options: { camera: 'garden', wakeOnStream: true, sleepWhenStreamEnds: false, keepAliveMs: 10_000 },
  }
}

function config(): CameraConfig {
  return {
    name: 'Garden',
    gatewayCamera: 'garden',
    videoConfig: { source: '-rtsp_transport tcp -i rtsp://192.168.1.10:8554/garden', maxWidth: 1920, maxHeight: 1080 },
  }
}

describe('streamingDelegate with a gateway camera', () => {
  beforeEach(() => {
    ffmpegRuns.length = 0
  })

  it('wakes the camera when HomeKit starts a stream and lets go when it stops', async () => {
    const gateway = gatewayCamera()
    const delegate = new StreamingDelegate(log, config(), api, hap, {} as PlatformAccessory, undefined, gateway)
    delegate.pendingSessions.set('s1', sessionInfo)

    delegate.handleStreamRequest(startRequest('s1'), vi.fn())
    await vi.waitFor(() => expect(gateway.client.wake).toHaveBeenCalledWith('garden'))
    expect(delegate.wakeKeeper!.watching).toBe(1)
    expect(ffmpegRuns[0]).toContain('-rtsp_transport tcp -i rtsp://192.168.1.10:8554/garden')

    delegate.handleStreamRequest({ type: 'stop', sessionID: 's1' } as any, vi.fn())
    expect(delegate.wakeKeeper!.watching).toBe(0)
    delegate.wakeKeeper!.shutdown()
  })

  it('fits every frame into one fixed size, so the picture can change size when the camera wakes', () => {
    const delegate = new StreamingDelegate(log, config(), api, hap, {} as PlatformAccessory, undefined, gatewayCamera())
    delegate.pendingSessions.set('s1', sessionInfo)
    delegate.handleStreamRequest(startRequest('s1'), vi.fn())
    expect(ffmpegRuns[0]).toContain('-filter:v scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1')
    delegate.wakeKeeper!.shutdown()
  })

  it('keeps the plain resize for cameras without a gateway', () => {
    const plain = { ...config(), gatewayCamera: undefined }
    const delegate = new StreamingDelegate(log, plain, api, hap, {} as PlatformAccessory)
    delegate.pendingSessions.set('s1', sessionInfo)
    delegate.handleStreamRequest(startRequest('s1'), vi.fn())
    expect(ffmpegRuns[0]).toContain('force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2')
    expect(ffmpegRuns[0]).not.toContain('pad=')
  })

  it('takes snapshots from the gateway, which never wakes the camera', async () => {
    const gateway = gatewayCamera()
    const delegate = new StreamingDelegate(log, config(), api, hap, {} as PlatformAccessory, undefined, gateway)
    expect((await delegate.fetchSnapshot()).toString()).toBe('jpeg')
    expect(gateway.client.snapshot).toHaveBeenCalledWith('garden')
    expect(gateway.client.wake).not.toHaveBeenCalled()
  })

  it('uses a configured stillImageSource instead of the gateway snapshot', () => {
    const gateway = gatewayCamera()
    const withStill = config()
    withStill.videoConfig!.stillImageSource = '-i http://192.168.1.10:8099/api/cameras/garden/snapshot.jpg'
    const delegate = new StreamingDelegate(log, withStill, api, hap, {} as PlatformAccessory, '/nonexistent/ffmpeg', gateway)
    delegate.fetchSnapshot().catch(() => {})
    expect(gateway.client.snapshot).not.toHaveBeenCalled()
  })
})
