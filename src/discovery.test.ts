import type { DiscoveredCamera, GatewayStatus } from './discovery.js'

import { describe, expect, it } from 'vitest'

import { brandingFor, cameraConfigFor, codecFor, discover, firmwareFrom, normalizeGatewayAddress } from './discovery.js'

describe('normalizeGatewayAddress', () => {
  it('turns an IP address into the gateway\'s web address on port 8099', () => {
    expect(normalizeGatewayAddress('192.168.1.10')).toBe('http://192.168.1.10:8099')
    expect(normalizeGatewayAddress(' 192.168.1.10/ ')).toBe('http://192.168.1.10:8099')
    expect(normalizeGatewayAddress('gateway.local')).toBe('http://gateway.local:8099')
  })

  it('keeps a port, a scheme and an IPv6 address', () => {
    expect(normalizeGatewayAddress('192.168.1.10:18099')).toBe('http://192.168.1.10:18099')
    expect(normalizeGatewayAddress('https://192.168.1.10:8443')).toBe('https://192.168.1.10:8443')
    expect(normalizeGatewayAddress('http://192.168.1.10:8099')).toBe('http://192.168.1.10:8099')
    expect(normalizeGatewayAddress('[fd00::10]')).toBe('http://[fd00::10]:8099')
  })

  it('refuses what is not just an address', () => {
    expect(() => normalizeGatewayAddress('')).toThrow('Enter the gateway\'s IP address')
    expect(() => normalizeGatewayAddress('192.168.1.10:8099/api/status')).toThrow('Enter only the gateway\'s address')
    expect(() => normalizeGatewayAddress('exa mple')).toThrow('is not an IP address or host name')
  })
})

describe('firmwareFrom', () => {
  it('keeps the numbers HomeKit accepts', () => {
    expect(firmwareFrom('0.5.1')).toBe('0.5.1')
    expect(firmwareFrom('0.5.1-beta.2')).toBe('0.5.1')
    expect(firmwareFrom('2')).toBe('2')
    expect(firmwareFrom(undefined)).toBe('1.0.0')
  })
})

describe('brandingFor', () => {
  it('names eufy, the model from the eufy account, the serial and the gateway version', () => {
    const devices = [{ serial: 'T8170XXXXXXXXXXX', model: 'T8170', modelName: 'SoloCam S340' }]
    expect(brandingFor({ serial: 'T8170XXXXXXXXXXX' }, devices, '0.5.1-beta.1')).toEqual({
      manufacturer: 'eufy',
      model: 'SoloCam S340',
      serialNumber: 'T8170XXXXXXXXXXX',
      firmwareRevision: '0.5.1',
    })
  })

  it('falls back to the model code, then to a plain name', () => {
    expect(brandingFor({ serial: 'A' }, [{ serial: 'A', model: 'T8222' }]).model).toBe('T8222')
    expect(brandingFor({ serial: 'B' }, []).model).toBe('eufy camera')
  })
})

describe('codecFor', () => {
  it('passes H.264 through when the camera sends H.264', () => {
    expect(codecFor({ video: { codec: 'h264', cameraCodec: 'h264', converted: false } }).vcodec).toBe('copy')
  })

  it('passes the gateway\'s own H.264 through when it converts the camera ("transcode": true)', () => {
    expect(codecFor({ video: { codec: 'h264', cameraCodec: 'hevc', converted: true, transcode: true } }).vcodec).toBe('copy')
    expect(codecFor({ video: { codec: 'h264', cameraCodec: null, converted: true, transcode: true } }).vcodec).toBe('copy')
  })

  it('tells "transcode": true from the text of gateways that don\'t report it', () => {
    expect(codecFor({ video: { codec: 'h264', cameraCodec: null, converted: true, text: 'H.264 · converted' } }).vcodec).toBe('copy')
    expect(codecFor({ video: { codec: 'h264', cameraCodec: null, converted: true, text: 'H.264 · converted until the camera\'s format is known' } }).vcodec).toBe('libx264')
  })

  it('converts H.265, which HomeKit cannot play', () => {
    const choice = codecFor({ video: { codec: 'hevc', cameraCodec: 'hevc', converted: false } })
    expect(choice.vcodec).toBe('libx264')
    expect(choice.note).toMatch(/H\.265/)
  })

  it('converts while the camera\'s format is not known yet: it may turn out to be H.265', () => {
    const choice = codecFor({ video: { codec: 'h264', cameraCodec: null, converted: true, transcode: false } })
    expect(choice.vcodec).toBe('libx264')
    expect(choice.note).toMatch(/doesn't know yet/)
  })
})

const status: GatewayStatus = {
  rtspPort: 8554,
  rtsp: { login: true },
  gateway: { version: '0.5.1' },
  cameras: [
    { name: 'front-door', serial: 'T8222XXXXXXXXXXX', state: 'IDLE', battery: 80, resolution: '2048x1536', audio: 'AAC · 16 kHz mono', video: { codec: 'h264', cameraCodec: 'h264', converted: false, text: 'H.264 · passed through, no conversion' } },
    { name: 'garden', serial: 'T8170XXXXXXXXXXX', state: 'LIVE', battery: null, resolution: '2880x1616', audio: null, video: { codec: 'hevc', cameraCodec: 'hevc', converted: false, text: 'H.265 · passed through, no conversion' } },
  ],
}
const devices = [{ serial: 'T8222XXXXXXXXXXX', modelName: 'Video Doorbell' }, { serial: 'T8170XXXXXXXXXXX', modelName: 'SoloCam S340' }]

describe('discover', () => {
  it('lists the gateway\'s cameras with everything that follows from them', async () => {
    const found = await discover(
      { url: '192.168.1.10', rtspUsername: 'nvr', rtspPassword: 'secret' },
      { status: async () => status, devices: async () => devices },
    )
    expect(found).toMatchObject({ url: 'http://192.168.1.10:8099', version: '0.5.1', rtspPort: 8554, rtspLogin: true })
    expect(found.cameras.map(c => [c.name, c.audio, c.codec.vcodec, c.branding.model])).toEqual([
      ['front-door', true, 'copy', 'Video Doorbell'],
      ['garden', false, 'libx264', 'SoloCam S340'],
    ])
    expect(found.cameras[0].source).toBe('-rtsp_transport tcp -i rtsp://nvr:***@192.168.1.10:8554/front-door')
  })

  it('still discovers when the device list is not available', async () => {
    const found = await discover({ url: '192.168.1.10' }, { status: async () => status, devices: async () => Promise.reject(new Error('HTTP 500')) })
    expect(found.cameras[0].branding.model).toBe('eufy camera')
  })
})

function discovered(overrides: Partial<DiscoveredCamera> = {}): DiscoveredCamera {
  return {
    name: 'front-door',
    serial: 'T8222XXXXXXXXXXX',
    state: 'IDLE',
    battery: 80,
    resolution: '2048x1536',
    audio: true,
    video: '',
    branding: { manufacturer: 'eufy', model: 'Video Doorbell', serialNumber: 'T8222XXXXXXXXXXX', firmwareRevision: '0.5.1' },
    codec: { vcodec: 'copy', note: '' },
    source: '',
    ...overrides,
  }
}

describe('cameraConfigFor', () => {
  it('makes a new camera\'s config from the gateway: name, branding, sound and codec', () => {
    expect(cameraConfigFor(discovered())).toEqual({
      name: 'front-door',
      gatewayCamera: 'front-door',
      manufacturer: 'eufy',
      model: 'Video Doorbell',
      serialNumber: 'T8222XXXXXXXXXXX',
      firmwareRevision: '0.5.1',
      sleepWhenStreamEnds: true, // sleep as soon as live view closes, by default
      videoConfig: { audio: true }, // the codec is picked at startup
    })
  })

  it('keeps what was chosen before, and other settings, but not a typed source', () => {
    const config = cameraConfigFor(discovered(), {
      name: 'old name',
      gatewayCamera: 'front-door',
      sleepWhenStreamEnds: true,
      motion: true,
      videoConfig: { audio: false, vcodec: 'libx264', maxBitrate: 800, source: '-i rtsp://old' },
    })
    expect(config.name).toBe('front-door')
    expect(config.sleepWhenStreamEnds).toBe(true)
    expect(config.motion).toBe(true)
    expect(config.videoConfig).toEqual({ audio: false, vcodec: 'libx264', maxBitrate: 800 })
  })

  it('keeps "sleep as soon as live view closes" off when it was turned off', () => {
    expect(cameraConfigFor(discovered(), { gatewayCamera: 'front-door', sleepWhenStreamEnds: false }).sleepWhenStreamEnds).toBe(false)
  })

  it('turns sound off when the gateway\'s stream has none', () => {
    const config = cameraConfigFor(discovered({ audio: false }), { gatewayCamera: 'front-door', videoConfig: { audio: true } })
    expect(config.videoConfig!.audio).toBe(false)
  })
})

describe('discover with a gateway that reports each camera\'s model', () => {
  it('takes the model from the camera list and doesn\'t ask for the device list (web login only)', async () => {
    let askedDevices = false
    const withModels: GatewayStatus = { ...status, cameras: status.cameras!.map(c => ({ ...c, model: `${c.name} model` })) }
    const found = await discover({ url: '192.168.1.10' }, {
      status: async () => withModels,
      devices: async () => {
        askedDevices = true
        return []
      },
    })
    expect(askedDevices).toBe(false)
    expect(found.cameras[1].branding.model).toBe('garden model')
  })
})
