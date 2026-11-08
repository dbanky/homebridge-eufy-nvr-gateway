import type { GatewayCameraOptions, GatewayState } from './gateway.js'

import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import { GatewayClient, gatewayProblem, WakeKeeper } from './gateway.js'

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function fakeFetch(answer: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: URL, init: RequestInit }> = []
  const fetchImpl = vi.fn(async (url: URL, init: RequestInit) => {
    calls.push({ url, init })
    return answer(url, init)
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

describe('gatewayProblem', () => {
  it('accepts an http or https URL', () => {
    expect(gatewayProblem({ url: 'http://192.168.1.10:8099' })).toBeNull()
    expect(gatewayProblem({ url: 'https://gateway.local:8099/' })).toBeNull()
  })

  it('names what is wrong', () => {
    expect(gatewayProblem(undefined)).toMatch(/no gateway URL/)
    expect(gatewayProblem({ url: '192.168.1.10:8099' })).toMatch(/http:\/\/ or https:\/\//)
    expect(gatewayProblem({ url: 'http://exa mple' })).toMatch(/is not a URL/)
    expect(gatewayProblem({ url: 'rtsp://192.168.1.10:8554' })).toMatch(/http:\/\/ or https:\/\//)
  })
})

describe('gatewayClient', () => {
  it('streams from the gateway host on port 8554 over TCP', () => {
    const client = new GatewayClient({ url: 'http://192.168.1.10:8099' })
    expect(client.rtspUrl('garden')).toBe('rtsp://192.168.1.10:8554/garden')
    expect(client.ffmpegSource('garden')).toBe('-rtsp_transport tcp -i rtsp://192.168.1.10:8554/garden')
  })

  it('puts the stream login and port into the RTSP URL, encoded', () => {
    const client = new GatewayClient({ url: 'http://192.168.1.10:8099', rtspPort: 18554, rtspUsername: 'nvr', rtspPassword: 'p@ss:word' })
    expect(client.rtspUrl('front door')).toBe('rtsp://nvr:p%40ss%3Aword@192.168.1.10:18554/front%20door')
  })

  it('keeps the brackets of an IPv6 host', () => {
    expect(new GatewayClient({ url: 'http://[fd00::10]:8099' }).rtspUrl('garden')).toBe('rtsp://[fd00::10]:8554/garden')
  })

  it('wakes a camera with POST /api/cameras/<name>/live', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ name: 'garden', state: 'WAKING' }))
    const client = new GatewayClient({ url: 'http://192.168.1.10:8099/' }, fetchImpl)
    expect(await client.wake('garden')).toBe('WAKING')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].url.href).toBe('http://192.168.1.10:8099/api/cameras/garden/live')
    expect((calls[0].init.headers as Record<string, string>).authorization).toBeUndefined()
  })

  it('lets a camera sleep with POST /api/cameras/<name>/idle', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ name: 'garden', state: 'IDLE' }))
    expect(await new GatewayClient({ url: 'http://192.168.1.10:8099' }, fetchImpl).sleep('garden')).toBe('IDLE')
    expect(calls[0].url.pathname).toBe('/api/cameras/garden/idle')
  })

  it('sends the web login as HTTP Basic', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ state: 'LIVE' }))
    await new GatewayClient({ url: 'http://192.168.1.10:8099', username: 'admin', password: 'sécret' }, fetchImpl).wake('garden')
    const header = (calls[0].init.headers as Record<string, string>).authorization
    expect(header).toBe(`Basic ${Buffer.from('admin:sécret', 'utf8').toString('base64')}`)
  })

  it('logs in with the stream login, not the web page\'s admin login', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ state: 'WAKING' }))
    const client = new GatewayClient({ url: 'http://192.168.1.10:8099', username: 'admin', password: 'web', rtspUsername: 'nvr', rtspPassword: 'stream' }, fetchImpl)
    await client.wake('garden')
    expect(calls).toHaveLength(1)
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('nvr:stream').toString('base64')}`)
    expect(client.usedLogin).toBe('stream')
  })

  it('falls back to the web login when the gateway refuses the stream login, and keeps using what worked', async () => {
    const web = `Basic ${Buffer.from('admin:web').toString('base64')}`
    const { fetchImpl, calls } = fakeFetch((_url, init) => ((init.headers as Record<string, string>).authorization === web ? json({ state: 'WAKING' }) : json({}, 401)))
    const client = new GatewayClient({ url: 'http://192.168.1.10:8099', username: 'admin', password: 'web', rtspUsername: 'nvr', rtspPassword: 'stream' }, fetchImpl)
    await client.wake('garden')
    expect(calls).toHaveLength(2)
    expect(client.usedLogin).toBe('web')
    await client.wake('garden')
    expect(calls).toHaveLength(3) // straight to the web login
    expect((calls[2].init.headers as Record<string, string>).authorization).toBe(web)
  })

  it('tries the web login when the stream login may not do something (403), e.g. the device list', async () => {
    const stream = `Basic ${Buffer.from('nvr:stream').toString('base64')}`
    const { fetchImpl } = fakeFetch((_url, init) => ((init.headers as Record<string, string>).authorization === stream ? json({ error: 'use the web login' }, 403) : json([])))
    const client = new GatewayClient({ url: 'http://192.168.1.10:8099', username: 'admin', password: 'web', rtspUsername: 'nvr', rtspPassword: 'stream' }, fetchImpl)
    expect(await client.devices()).toEqual([])
  })

  it('sends no login when none is set', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ state: 'IDLE' }))
    const client = new GatewayClient({ url: 'http://192.168.1.10:8099' }, fetchImpl)
    await client.wake('garden')
    expect((calls[0].init.headers as Record<string, string>).authorization).toBeUndefined()
    expect(client.usedLogin).toBe('none')
  })

  it('reads one camera\'s state from /api/status', async () => {
    const { fetchImpl } = fakeFetch(() => json({ cameras: [{ name: 'front-door', state: 'LIVE' }, { name: 'garden', state: 'IDLE' }] }))
    const client = new GatewayClient({ url: 'http://192.168.1.10:8099' }, fetchImpl)
    expect(await client.state('garden')).toBe('IDLE')
    await expect(client.state('shed')).rejects.toThrow('no camera named "shed"')
  })

  it('fetches the snapshot as a JPEG buffer', async () => {
    const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9])
    const { fetchImpl, calls } = fakeFetch(() => new Response(jpeg, { status: 200, headers: { 'content-type': 'image/jpeg' } }))
    const image = await new GatewayClient({ url: 'http://192.168.1.10:8099' }, fetchImpl).snapshot('front door')
    expect(image.equals(jpeg)).toBe(true)
    expect(calls[0].url.pathname).toBe('/api/cameras/front%20door/snapshot.jpg')
  })

  it('explains a wrong login or camera name', async () => {
    await expect(new GatewayClient({ url: 'http://192.168.1.10:8099' }, fakeFetch(() => json({}, 401)).fetchImpl).wake('garden'))
      .rejects
      .toThrow(/HTTP 401 \(check the stream login/)
    await expect(new GatewayClient({ url: 'http://192.168.1.10:8099' }, fakeFetch(() => json({}, 404)).fetchImpl).wake('shed'))
      .rejects
      .toThrow(/HTTP 404 \(check the camera name/)
    await expect(new GatewayClient({ url: 'http://192.168.1.10:8099' }, fakeFetch(() => json({}, 429)).fetchImpl).wake('garden'))
      .rejects
      .toThrow(/HTTP 429 \(too many wrong logins/)
  })

  it('reports an unreachable gateway', async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new TypeError('fetch failed')
    })
    await expect(new GatewayClient({ url: 'http://192.168.1.10:8099' }, fetchImpl).wake('garden')).rejects.toThrow('POST /api/cameras/garden/live: fetch failed')
  })
})

const settle = () => new Promise(resolve => setImmediate(resolve))

function setup(options: Partial<GatewayCameraOptions> = {}, initialState: GatewayState = 'IDLE') {
  const client = {
    wake: vi.fn(async () => 'WAKING' as GatewayState),
    sleep: vi.fn(async () => 'IDLE' as GatewayState),
    state: vi.fn(async () => initialState),
  }
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }
  const intervals: Array<{ fn: () => void, ms: number, cleared: boolean }> = []
  const timers = {
    setInterval: (fn: () => void, ms: number) => {
      const handle = { fn, ms, cleared: false }
      intervals.push(handle)
      return handle
    },
    clearInterval: (handle: unknown) => {
      (handle as { cleared: boolean }).cleared = true
    },
  }
  const keeper = new WakeKeeper(client, { camera: 'garden', wakeOnStream: true, sleepWhenStreamEnds: false, keepAliveMs: 10_000, ...options }, log, 'Garden', timers)
  return { keeper, client, log, intervals }
}

describe('wakeKeeper', () => {
  it('wakes the camera when the first HomeKit stream starts', async () => {
    const { keeper, client, log } = setup()
    await keeper.streamStarted('a')
    expect(client.wake).toHaveBeenCalledWith('garden')
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Waking the camera for HomeKit'), 'Garden')
  })

  it('wakes it once for several viewers, and keeps it awake until the last one leaves', async () => {
    const { keeper, client, intervals } = setup({}, 'LIVE')
    await keeper.streamStarted('a')
    await keeper.streamStarted('b')
    expect(client.wake).toHaveBeenCalledTimes(1)
    expect(intervals).toHaveLength(1)
    expect(intervals[0].ms).toBe(10_000)

    intervals[0].fn()
    await settle()
    intervals[0].fn()
    await settle()
    expect(client.wake).toHaveBeenCalledTimes(3)

    await keeper.streamEnded('a')
    expect(intervals[0].cleared).toBe(false)
    await keeper.streamEnded('b')
    expect(intervals[0].cleared).toBe(true)
    expect(keeper.watching).toBe(0)
  })

  it('never starts a new session when the gateway ended one by itself (no picture, offline, maxLiveMs)', async () => {
    const { keeper, client, log, intervals } = setup({}, 'LIVE')
    await keeper.streamStarted('a')
    client.state.mockResolvedValue('IDLE')
    intervals[0].fn()
    await settle()
    expect(client.wake).toHaveBeenCalledTimes(1)
    expect(intervals[0].cleared).toBe(true)
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('stays asleep until the next live view'), 'Garden')

    await keeper.streamEnded('a') // and the next live view wakes it again
    await keeper.streamStarted('b')
    expect(client.wake).toHaveBeenCalledTimes(2)
  })

  it('by default leaves the camera to the gateway\'s hold time when nobody watches', async () => {
    const { keeper, client } = setup()
    await keeper.streamStarted('a')
    await keeper.streamEnded('a')
    expect(client.sleep).not.toHaveBeenCalled()
    expect(client.state).not.toHaveBeenCalled()
  })

  it('with sleepWhenStreamEnds, lets a camera sleep that HomeKit woke', async () => {
    const { keeper, client } = setup({ sleepWhenStreamEnds: true }, 'IDLE')
    await keeper.streamStarted('a')
    await keeper.streamEnded('a')
    expect(client.sleep).toHaveBeenCalledWith('garden')
  })

  it('with sleepWhenStreamEnds, leaves a camera awake that was already awake (e.g. recording motion)', async () => {
    const { keeper, client } = setup({ sleepWhenStreamEnds: true }, 'LIVE')
    await keeper.streamStarted('a')
    await keeper.streamEnded('a')
    expect(client.sleep).not.toHaveBeenCalled()
  })

  it('does nothing with wakeOnStream off', async () => {
    const { keeper, client, intervals } = setup({ wakeOnStream: false })
    await keeper.streamStarted('a')
    await keeper.streamEnded('a')
    expect(client.wake).not.toHaveBeenCalled()
    expect(intervals).toHaveLength(0)
  })

  it('ignores the end of a session it never saw, and a second end of the same one', async () => {
    const { keeper, client, intervals } = setup()
    await keeper.streamEnded('unknown')
    await keeper.streamStarted('a')
    await keeper.streamEnded('a')
    await keeper.streamEnded('a')
    expect(intervals.filter(i => i.cleared)).toHaveLength(1)
    expect(client.wake).toHaveBeenCalledTimes(1)
  })

  it('does not start keeping awake when the stream ended while the state was still being read', async () => {
    const { keeper, client, intervals } = setup({ sleepWhenStreamEnds: true })
    let answer: (state: GatewayState) => void = () => {}
    client.state.mockImplementationOnce(() => new Promise(resolve => (answer = resolve)))
    const starting = keeper.streamStarted('a')
    await keeper.streamEnded('a')
    answer('IDLE')
    await starting
    expect(client.wake).not.toHaveBeenCalled()
    expect(intervals).toHaveLength(0)
  })

  it('never throws when the gateway is down, warns once, and wakes the camera once it answers', async () => {
    const { keeper, client, log, intervals } = setup()
    client.wake.mockRejectedValue(new Error('fetch failed'))
    await expect(keeper.streamStarted('a')).resolves.toBeUndefined()
    intervals[0].fn()
    await settle()
    expect(client.wake).toHaveBeenCalledTimes(2) // the wake-up is retried, not skipped as "asleep"
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith('Could not wake the camera: fetch failed', 'Garden')

    client.wake.mockResolvedValue('WAKING')
    intervals[0].fn()
    await settle()
    expect(log.info).toHaveBeenCalledWith('Waking the camera for HomeKit (gateway: waking).', 'Garden')
  })

  it('says so when the gateway answers keep-alives again', async () => {
    const { keeper, client, log, intervals } = setup({}, 'LIVE')
    await keeper.streamStarted('a')
    client.state.mockRejectedValueOnce(new Error('fetch failed'))
    intervals[0].fn()
    await settle()
    expect(log.warn).toHaveBeenCalledWith('Could not keep the camera awake: fetch failed', 'Garden')
    intervals[0].fn()
    await settle()
    expect(log.info).toHaveBeenCalledWith('The gateway answers again: keeping the camera awake.', 'Garden')
    expect(intervals[0].cleared).toBe(false)
  })

  it('stops keeping awake on shutdown', async () => {
    const { keeper, intervals } = setup()
    await keeper.streamStarted('a')
    keeper.shutdown()
    expect(intervals[0].cleared).toBe(true)
    expect(keeper.watching).toBe(0)
  })
})
