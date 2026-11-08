// The eufy-nvr-gateway side of a camera.
//
// The gateway turns a battery eufy camera into an always-on RTSP stream: while the camera sleeps the
// stream shows its last picture, and only a trigger wakes it for live video. Homebridge watching the
// RTSP stream therefore does NOT wake the camera by itself. This module does what homebridge-eufy
// does when the Home app opens a camera:
//
//   - the first HomeKit viewer wakes the camera (POST /api/cameras/<name>/live, a "manual" trigger,
//     which the gateway honours even on a low battery),
//   - while anyone watches, the wake-up is repeated so the gateway's hold time never runs out,
//   - after the last viewer leaves, the camera falls asleep when the gateway's hold time ends
//     (or at once with `sleepWhenStreamEnds`, if HomeKit was what woke it),
//   - snapshots come from the gateway (GET /api/cameras/<name>/snapshot.jpg), which never wakes a
//     camera: the last picture while asleep, the live picture while awake.

import { Buffer } from 'node:buffer'

export interface GatewayConfig {
  url?: string // the gateway's web page, e.g. http://192.168.1.10:8099
  username?: string // the web page's login, if it has one ("web" in the gateway's config.json)
  password?: string
  rtspPort?: number // default 8554
  rtspUsername?: string // the streams' login, if they have one ("rtsp" in the gateway's config.json)
  rtspPassword?: string
}

export interface GatewayCameraOptions {
  camera: string // the camera's "name" in the gateway's config.json
  wakeOnStream: boolean
  sleepWhenStreamEnds: boolean
  keepAliveMs: number
}

export type GatewayState = 'IDLE' | 'WAKING' | 'LIVE'

interface Log {
  debug: (message: string, name?: string, always?: boolean) => void
  info: (message: string, name?: string) => void
  warn: (message: string, name?: string) => void
}

type Fetch = typeof fetch

export const DEFAULT_RTSP_PORT = 8554
// The gateway ends a session `holdMs` (30 s by default) after the last trigger: repeat well inside it.
export const DEFAULT_KEEP_ALIVE_MS = 10_000
const REQUEST_TIMEOUT_MS = 5_000
const SNAPSHOT_TIMEOUT_MS = 10_000

// Why a gateway block can't be used, or null when it can.
export function gatewayProblem(config?: GatewayConfig): string | null {
  if (!config?.url) {
    return 'no gateway URL is set (platform setting "gateway.url", e.g. http://192.168.1.10:8099)'
  }
  if (!/^https?:\/\//i.test(config.url)) {
    return `the gateway URL "${config.url}" must start with http:// or https:// (e.g. http://192.168.1.10:8099)`
  }
  try {
    new URL(config.url)
  } catch {
    return `the gateway URL "${config.url}" is not a URL`
  }
  return null
}

const cameraPath = (camera: string, action: string): string => `/api/cameras/${encodeURIComponent(camera)}/${action}`

export class GatewayClient {
  private readonly base: URL

  constructor(private readonly config: GatewayConfig, private readonly fetchImpl: Fetch = fetch) {
    const problem = gatewayProblem(config)
    if (problem) {
      throw new Error(problem)
    }
    this.base = new URL(config.url!)
  }

  // The camera's stream on the gateway's RTSP server (same host as the web page).
  rtspUrl(camera: string): string {
    const { rtspUsername, rtspPassword } = this.config
    const login = rtspUsername
      ? `${encodeURIComponent(rtspUsername)}:${encodeURIComponent(rtspPassword ?? '')}@`
      : ''
    const port = this.config.rtspPort || DEFAULT_RTSP_PORT
    return `rtsp://${login}${this.base.hostname}:${port}/${encodeURIComponent(camera)}`
  }

  // FFmpeg input options for the stream. TCP: no UDP ports to open, nothing lost on Wi-Fi.
  ffmpegSource(camera: string): string {
    return `-rtsp_transport tcp -i ${this.rtspUrl(camera)}`
  }

  async wake(camera: string): Promise<GatewayState> {
    const status = await this.json('POST', cameraPath(camera, 'live'))
    return status.state
  }

  async sleep(camera: string): Promise<GatewayState> {
    const status = await this.json('POST', cameraPath(camera, 'idle'))
    return status.state
  }

  // The whole /api/status answer: the gateway, its RTSP port and login, and every camera.
  status(): Promise<any> {
    return this.json('GET', '/api/status')
  }

  // The devices on the gateway's eufy account (model names for the branding).
  devices(): Promise<any[]> {
    return this.json('GET', '/api/devices')
  }

  async state(camera: string): Promise<GatewayState> {
    const status = await this.status()
    const found = (status.cameras ?? []).find((c: { name: string }) => c.name === camera)
    if (!found) {
      throw new Error(`the gateway has no camera named "${camera}"`)
    }
    return found.state
  }

  async snapshot(camera: string): Promise<Buffer> {
    const res = await this.request('GET', cameraPath(camera, 'snapshot.jpg'), SNAPSHOT_TIMEOUT_MS)
    const image = Buffer.from(await res.arrayBuffer())
    if (image.length === 0) {
      throw new Error('the gateway sent an empty snapshot')
    }
    return image
  }

  private async json(method: string, path: string): Promise<any> {
    const res = await this.request(method, path, REQUEST_TIMEOUT_MS)
    return res.json()
  }

  // The logins for the gateway's API, in order. The stream login comes first: the gateway accepts it
  // for everything this plugin does (the camera list, snapshots, wake and sleep), so Homebridge never
  // needs the web page's admin login. The web login is the fallback for gateways that only accept
  // that one. After a success, the login that worked is tried first.
  private loginsInOrder(): Array<ApiLogin | null> {
    const logins: ApiLogin[] = []
    if (this.config.rtspUsername) {
      logins.push({ kind: 'stream', header: basicHeader(this.config.rtspUsername, this.config.rtspPassword) })
    }
    if (this.config.username) {
      logins.push({ kind: 'web', header: basicHeader(this.config.username, this.config.password) })
    }
    if (logins.length === 0) {
      return [null]
    }
    return this.worked ? [...logins].sort(a => (a.kind === this.worked ? -1 : 1)) : logins
  }

  private worked: ApiLogin['kind'] | null = null

  // Which login the gateway took last: 'stream', 'web', or 'none' (it needs none).
  get usedLogin(): ApiLogin['kind'] | 'none' {
    return this.worked ?? 'none'
  }

  private async request(method: string, path: string, timeoutMs: number): Promise<Response> {
    const url = new URL(path, this.base)
    const logins = this.loginsInOrder()
    let res: Response | undefined
    for (const [index, login] of logins.entries()) {
      const headers: Record<string, string> = login ? { authorization: login.header } : {}
      try {
        res = await this.fetchImpl(url, { method, headers, signal: AbortSignal.timeout(timeoutMs) })
      } catch (error) {
        const why = (error as Error).name === 'TimeoutError' ? `no answer within ${timeoutMs / 1000} s` : (error as Error).message
        throw new Error(`${method} ${url.pathname}: ${why}`)
      }
      const refused = res.status === 401 || res.status === 403
      if (refused && index < logins.length - 1) {
        continue // try the next login
      }
      if (res.ok && login) {
        this.worked = login.kind
      }
      break
    }
    if (!res!.ok) {
      const status = res!.status
      const hint = status === 401
        ? ' (check the stream login, "gateway.rtspUsername" and "gateway.rtspPassword"; gateways before 0.6.0 need the web login, "gateway.username" and "gateway.password")'
        : status === 404
          ? ' (check the camera name: it must match "name" in the gateway\'s config.json)'
          : status === 429
            ? ' (too many wrong logins from this machine: the gateway refuses its logins for a few minutes; check the password)'
            : ''
      throw new Error(`${method} ${url.pathname}: HTTP ${status}${hint}`)
    }
    return res!
  }
}

interface ApiLogin {
  kind: 'stream' | 'web'
  header: string
}

function basicHeader(username: string, password?: string): string {
  return `Basic ${Buffer.from(`${username}:${password ?? ''}`, 'utf8').toString('base64')}`
}

interface Timers {
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
}

const realTimers: Timers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: handle => clearInterval(handle as NodeJS.Timeout),
}

// Keeps one camera awake while at least one HomeKit stream session is open.
export class WakeKeeper {
  private readonly sessions = new Set<string>()
  private timer: unknown = null
  private wokeIt = false // whether this camera was asleep when HomeKit woke it
  private failing = false
  private woken = false // the gateway took this live view's wake-up
  private generation = 0 // bumps on every first-start and last-stop, so late answers are ignored

  constructor(
    private readonly client: Pick<GatewayClient, 'wake' | 'sleep' | 'state'>,
    private readonly options: GatewayCameraOptions,
    private readonly log: Log,
    private readonly cameraName: string,
    private readonly timers: Timers = realTimers,
  ) {}

  get watching(): number {
    return this.sessions.size
  }

  // A HomeKit stream session started. Never throws and never delays the stream: until the camera
  // is live the stream shows the gateway's "Waking up" picture.
  async streamStarted(sessionId: string): Promise<void> {
    if (!this.options.wakeOnStream) {
      return
    }
    this.sessions.add(sessionId)
    if (this.sessions.size > 1) {
      return
    }
    const generation = ++this.generation
    this.wokeIt = false
    this.woken = false
    if (this.options.sleepWhenStreamEnds) {
      try {
        this.wokeIt = (await this.client.state(this.options.camera)) === 'IDLE'
      } catch (error) {
        this.log.warn(`Could not read the camera's state from the gateway: ${(error as Error).message}`, this.cameraName)
      }
      if (generation !== this.generation) {
        return // the stream already ended
      }
    }
    this.timer = this.timers.setInterval(() => void this.keepAwake(generation), this.options.keepAliveMs)
    await this.wake(generation)
  }

  // A HomeKit stream session ended (or was never started).
  async streamEnded(sessionId: string): Promise<void> {
    if (!this.sessions.delete(sessionId) || this.sessions.size > 0) {
      return
    }
    this.generation++
    this.stopTimer()
    if (this.options.sleepWhenStreamEnds && this.wokeIt) {
      this.wokeIt = false
      try {
        await this.client.sleep(this.options.camera)
        this.log.info('Nobody is watching: the gateway lets the camera sleep.', this.cameraName)
      } catch (error) {
        this.log.warn(`Could not let the camera sleep: ${(error as Error).message}`, this.cameraName)
      }
    } else {
      this.log.debug('Nobody is watching: the camera sleeps when the gateway\'s hold time ends.', this.cameraName)
    }
  }

  // Stop everything (Homebridge shuts down). Leaves the camera to the gateway's hold time.
  shutdown(): void {
    this.sessions.clear()
    this.generation++
    this.stopTimer()
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      this.timers.clearInterval(this.timer)
      this.timer = null
    }
  }

  private async wake(generation: number): Promise<void> {
    try {
      const state = await this.client.wake(this.options.camera)
      if (generation !== this.generation) {
        return
      }
      this.woken = true
      this.log.info(`Waking the camera for HomeKit (gateway: ${state.toLowerCase()}).`, this.cameraName)
      this.failing = false
    } catch (error) {
      this.failed('wake', error as Error)
    }
  }

  // Every keepAliveMs while anyone watches. Extends the gateway's session, but never starts a new one:
  // if the gateway ended it by itself (the camera didn't wake or went offline, "maxLiveMs" was
  // reached, or someone pressed sleep on its web page), waking it again every few seconds would
  // only loop. The next live view tries again.
  private async keepAwake(generation: number): Promise<void> {
    if (!this.woken) {
      return this.wake(generation) // the first wake-up didn't reach the gateway: try again
    }
    try {
      const state = await this.client.state(this.options.camera)
      if (generation !== this.generation) {
        return
      }
      if (state === 'IDLE') {
        this.stopTimer()
        this.log.info('The gateway ended the camera\'s live session; it stays asleep until the next live view.', this.cameraName)
        return
      }
      await this.client.wake(this.options.camera)
      if (this.failing) {
        this.log.info('The gateway answers again: keeping the camera awake.', this.cameraName)
      }
      this.failing = false
    } catch (error) {
      this.failed('keep awake', error as Error)
    }
  }

  private failed(what: 'wake' | 'keep awake', error: Error): void {
    if (!this.failing) {
      this.log.warn(`Could not ${what === 'wake' ? 'wake the camera' : 'keep the camera awake'}: ${error.message}`, this.cameraName)
    }
    this.failing = true
  }
}
