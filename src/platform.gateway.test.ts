import type { API, Logging, PlatformConfig } from 'homebridge'

import { describe, expect, it, vi } from 'vitest'

import { FfmpegPlatform } from './platform.js'

vi.mock('mqtt', () => ({ default: { connect: vi.fn() } }))

function logging() {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), success: vi.fn() }
  return log as unknown as Logging & typeof log
}
const api = { on: vi.fn(), hap: { uuid: { generate: (name: string) => `uuid-${name}` } } } as unknown as API

const cameraConfigs = (platform: FfmpegPlatform) => (platform as any).cameraConfigs as Map<string, any>

describe('ffmpegPlatform with the eufy-nvr-gateway', () => {
  it('streams a gateway camera from the gateway\'s RTSP server when no source is set', () => {
    const config = {
      platform: 'EufyNvrGateway',
      gateway: { url: 'http://192.168.1.10:8099', rtspUsername: 'nvr', rtspPassword: 'secret' },
      cameras: [{ name: 'Garden', gatewayCamera: 'garden' }],
    } as unknown as PlatformConfig
    const platform = new FfmpegPlatform(logging(), config, api)
    expect(cameraConfigs(platform).get('uuid-Garden').videoConfig.source)
      .toBe('-rtsp_transport tcp -i rtsp://nvr:secret@192.168.1.10:8554/garden')
  })

  it('keeps a source that is set', () => {
    const config = {
      platform: 'EufyNvrGateway',
      gateway: { url: 'http://192.168.1.10:8099' },
      cameras: [{ name: 'Garden', gatewayCamera: 'garden', videoConfig: { source: '-i rtsp://192.168.1.10:8554/garden~mjpeg' } }],
    } as unknown as PlatformConfig
    const platform = new FfmpegPlatform(logging(), config, api)
    expect(cameraConfigs(platform).get('uuid-Garden').videoConfig.source).toBe('-i rtsp://192.168.1.10:8554/garden~mjpeg')
  })

  it('skips a gateway camera, with a clear error, when the gateway URL is missing', () => {
    const log = logging()
    const config = { platform: 'EufyNvrGateway', cameras: [{ name: 'Garden', gatewayCamera: 'garden' }] } as unknown as PlatformConfig
    const platform = new FfmpegPlatform(log, config, api)
    expect(cameraConfigs(platform).size).toBe(0)
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('"gatewayCamera" is set, but no gateway URL is set'))
  })

  it('leaves ordinary cameras as they were', () => {
    const config = {
      platform: 'EufyNvrGateway',
      cameras: [{ name: 'Porch', videoConfig: { source: '-i rtsp://192.168.1.20/stream' } }],
    } as unknown as PlatformConfig
    const platform = new FfmpegPlatform(logging(), config, api)
    expect(cameraConfigs(platform).get('uuid-Porch').videoConfig.source).toBe('-i rtsp://192.168.1.20/stream')
  })
})

describe('the gateway check at startup', () => {
  it('confirms each gateway camera, and warns about one the gateway does not know', async () => {
    const log = logging()
    const config = {
      platform: 'EufyNvrGateway',
      gateway: { url: 'http://192.168.1.10:8099' },
      cameras: [{ name: 'Garden', gatewayCamera: 'garden' }, { name: 'Shed', gatewayCamera: 'shed' }],
    } as unknown as PlatformConfig
    const platform = new FfmpegPlatform(log, config, api)
    const gateway = (platform as any).gateway
    gateway.status = vi.fn(async () => ({ gateway: { version: '0.5.1' }, cameras: [{ name: 'garden', serial: 'T8170XXXXXXXXXXX', state: 'IDLE' }] }))
    gateway.devices = vi.fn(async () => [])
    await platform.checkGateway()
    expect(log.info).toHaveBeenCalledWith('[Garden] Found on the gateway as "garden" (idle).')
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('[Shed] The gateway check failed: the gateway has no camera named "shed"'))
  })
})

describe('branding at startup', () => {
  it('fills in what the config leaves out from the gateway, and keeps what it sets', async () => {
    const config = {
      platform: 'EufyNvrGateway',
      gateway: { url: 'http://192.168.1.10:8099' },
      cameras: [{ name: 'Garden', gatewayCamera: 'garden', model: 'My model' }],
    } as unknown as PlatformConfig
    const set = vi.fn()
    const hapApi = {
      ...api,
      hap: { ...(api as any).hap, Service: { AccessoryInformation: 'info' }, Characteristic: { Manufacturer: 'M', Model: 'Mo', SerialNumber: 'S', FirmwareRevision: 'F' } },
    } as unknown as API
    const platform = new FfmpegPlatform(logging(), config, hapApi);
    (platform as any).accessories.push({ displayName: 'Garden', getService: () => ({ setCharacteristic: set }) })
    const gateway = (platform as any).gateway
    gateway.status = vi.fn(async () => ({ gateway: { version: '0.5.1-beta.1' }, cameras: [{ name: 'garden', serial: 'T8170XXXXXXXXXXX', state: 'IDLE' }] }))
    gateway.devices = vi.fn(async () => [{ serial: 'T8170XXXXXXXXXXX', modelName: 'SoloCam S340' }])
    await platform.checkGateway()
    expect(set.mock.calls).toEqual([['M', 'eufy'], ['S', 'T8170XXXXXXXXXXX'], ['F', '0.5.1']])
  })
})

describe('the automatic video codec', () => {
  function platformWith(vcodec?: string) {
    const log = logging()
    const config = {
      platform: 'EufyNvrGateway',
      gateway: { url: 'http://192.168.1.10:8099' },
      cameras: [{ name: 'Garden', gatewayCamera: 'garden', manufacturer: 'eufy', model: 'm', serialNumber: 's', firmwareRevision: '1', videoConfig: { vcodec } }],
    } as unknown as PlatformConfig
    const platform = new FfmpegPlatform(log, config, api)
    const gateway = (platform as any).gateway
    return { platform, log, gateway, camera: () => cameraConfigs(platform).get('uuid-Garden') }
  }
  const status = (video: object) => async () => ({ cameras: [{ name: 'garden', serial: 's', state: 'IDLE', video }] })

  it('is picked from the gateway at startup when the config has none', async () => {
    const { platform, gateway, camera, log } = platformWith()
    gateway.status = status({ codec: 'h264', cameraCodec: 'h264', converted: false, transcode: false })
    await platform.checkGateway()
    expect(camera().videoConfig.vcodec).toBe('copy')
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('[Garden] Video codec copy (automatic)'))
  })

  it('converts an H.265 stream', async () => {
    const { platform, gateway, camera } = platformWith()
    gateway.status = status({ codec: 'hevc', cameraCodec: 'hevc', converted: false, transcode: false })
    await platform.checkGateway()
    expect(camera().videoConfig.vcodec).toBe('libx264')
  })

  it('keeps a chosen codec, and warns when "copy" can\'t play', async () => {
    const { platform, gateway, camera, log } = platformWith('copy')
    gateway.status = status({ codec: 'hevc', cameraCodec: 'hevc', converted: false, transcode: false })
    await platform.checkGateway()
    expect(camera().videoConfig.vcodec).toBe('copy')
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('vcodec "copy": The gateway streams this camera as H.265'))
  })
})
