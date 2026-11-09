// A camera's Eufy mode in HomeKit: a security system on the camera's accessory. Home, Away and Off
// switch the camera's Eufy mode to Home, Away and Disarmed, through the gateway and the eufy SDK
// (eufy NVR Gateway 0.7.0 or later), as the eufy app would. What each mode does is set in the eufy app.
// The mode belongs to the camera's station: a camera behind a HomeBase or chime shares it.

import type { API, PlatformAccessory, Service } from 'homebridge'

import type { EufyMode, GatewayClient } from './gateway.js'
import type { Logger } from './logger.js'

// HomeKit's security system states (SecuritySystemCurrentState / TargetState). Night is left out.
export const HOMEKIT = { home: 0, away: 1, off: 3 } as const
const HOMEKIT_STATES = [HOMEKIT.home, HOMEKIT.away, HOMEKIT.off]

// The Eufy modes HomeKit can switch a camera to ("eufyModes" in the camera's config; Disarmed is
// HomeKit's Off), in HomeKit's order.
export type OfferedEufyMode = 'home' | 'away' | 'disarmed'
export const OFFERED_EUFY_MODES: OfferedEufyMode[] = ['home', 'away', 'disarmed']

// The HomeKit states to offer for the configured modes: all three when none (or none valid) are set.
export function offeredStates(modes?: unknown[]): number[] {
  const wanted = OFFERED_EUFY_MODES.filter(m => !Array.isArray(modes) || modes.includes(m))
  const states = wanted.map(m => (m === 'disarmed' ? HOMEKIT.off : HOMEKIT[m]))
  return states.length ? states : HOMEKIT_STATES
}

const LABELS: Record<EufyMode, string> = {
  away: 'Away',
  home: 'Home',
  schedule: 'Schedule',
  custom1: 'Custom 1',
  custom2: 'Custom 2',
  custom3: 'Custom 3',
  off: 'Off',
  geo: 'Geofencing',
  disarmed: 'Disarmed',
}
export const eufyModeLabel = (mode: EufyMode): string => LABELS[mode] ?? mode

// The Eufy mode HomeKit's state switches to.
export function eufyModeFor(state: number): EufyMode | undefined {
  return state === HOMEKIT.home ? 'home' : state === HOMEKIT.away ? 'away' : state === HOMEKIT.off ? 'disarmed' : undefined
}

// How HomeKit shows an Eufy mode. HomeKit has only Home, Away and Off: eufy's own Off is Off, and
// its other armed modes (Schedule, Custom 1–3, Geofencing) show as Away.
export function homeKitStateFor(mode: EufyMode): number {
  if (mode === 'home') {
    return HOMEKIT.home
  }
  return mode === 'disarmed' || mode === 'off' ? HOMEKIT.off : HOMEKIT.away
}

export class EufyModeSwitch {
  private readonly service: Service
  private mode: EufyMode | null = null
  // The Home app offers only these (the configured modes). The current state may still be any of
  // the three, so a mode set elsewhere (the eufy app, its schedule) shows as it is; the target then
  // keeps the last offered one, because HomeKit refuses a target outside its list.
  private readonly offered: number[]
  private target: number

  constructor(
    private readonly api: API,
    private readonly log: Logger,
    private readonly client: Pick<GatewayClient, 'setEufyMode'>,
    accessory: PlatformAccessory,
    private readonly cameraName: string,
    private readonly gatewayCamera: string,
    modes?: unknown[],
  ) {
    this.offered = offeredStates(modes)
    this.target = this.offered.includes(HOMEKIT.off) ? HOMEKIT.off : this.offered[0]
    const { Service, Characteristic } = api.hap
    this.service = accessory.getService(Service.SecuritySystem) ?? accessory.addService(Service.SecuritySystem, `${cameraName} Eufy mode`)
    this.service.getCharacteristic(Characteristic.SecuritySystemCurrentState)
      .setProps({ validValues: HOMEKIT_STATES })
      .onGet(() => this.current())
    this.service.getCharacteristic(Characteristic.SecuritySystemTargetState)
      .setProps({ validValues: this.offered })
      .onGet(() => this.target)
      .onSet(value => this.switchTo(value as number))
  }

  // HomeKit asks: the last known mode, at once. Until the gateway has told it (a moment after
  // startup), Off: a failing read would mark the whole camera as not responding.
  private current(): number {
    return this.mode ? homeKitStateFor(this.mode) : HOMEKIT.off
  }

  // The camera's Eufy mode, as the gateway reports it (startup, then every 30 s).
  show(mode: EufyMode | null | undefined): void {
    if (!mode || mode === this.mode) {
      return
    }
    const first = this.mode === null
    this.mode = mode
    const state = homeKitStateFor(mode)
    const { Characteristic } = this.api.hap
    if (this.offered.includes(state)) {
      this.target = state
      this.service.updateCharacteristic(Characteristic.SecuritySystemTargetState, state)
    }
    this.service.updateCharacteristic(Characteristic.SecuritySystemCurrentState, state)
    const shown = mode === 'home' || mode === 'away' || mode === 'disarmed' ? '' : ` (shown in HomeKit as ${state === HOMEKIT.off ? 'Off' : 'Away'})`
    this.log.info(`Eufy mode ${eufyModeLabel(mode)}${first ? '' : ' (switched elsewhere)'}${shown}.`, this.cameraName)
  }

  private async switchTo(state: number): Promise<void> {
    const mode = eufyModeFor(state)
    if (!mode || !this.offered.includes(state)) {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST)
    }
    try {
      await this.client.setEufyMode(this.gatewayCamera, mode)
      this.mode = mode
      this.target = state
      this.log.info(`Eufy mode ${eufyModeLabel(mode)} (from HomeKit).`, this.cameraName)
      this.service.updateCharacteristic(this.api.hap.Characteristic.SecuritySystemCurrentState, homeKitStateFor(mode))
    } catch (error) {
      this.log.warn(`Could not switch the Eufy mode to ${eufyModeLabel(mode)}: ${(error as Error).message}`, this.cameraName)
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
    }
  }
}
