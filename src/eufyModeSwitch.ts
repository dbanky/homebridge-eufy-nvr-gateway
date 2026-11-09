// A camera's eufy mode in HomeKit: a security system on the camera's accessory. Home, Away and Off
// switch the camera's eufy mode to Home, Away and Disarmed, through the gateway and the eufy SDK
// (eufy NVR Gateway 0.7.0 or later), as the eufy app would. What each mode does is set in the eufy app.
// The mode belongs to the camera's station: a camera behind a HomeBase or chime shares it.

import type { API, PlatformAccessory, Service } from 'homebridge'

import type { EufyMode, GatewayClient } from './gateway.js'
import type { Logger } from './logger.js'

// HomeKit's security system states (SecuritySystemCurrentState / TargetState). Night is left out.
export const HOMEKIT = { home: 0, away: 1, off: 3 } as const
const HOMEKIT_STATES = [HOMEKIT.home, HOMEKIT.away, HOMEKIT.off]

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

// The eufy mode HomeKit's state switches to.
export function eufyModeFor(state: number): EufyMode | undefined {
  return state === HOMEKIT.home ? 'home' : state === HOMEKIT.away ? 'away' : state === HOMEKIT.off ? 'disarmed' : undefined
}

// How HomeKit shows an eufy mode. HomeKit has only Home, Away and Off: eufy's own Off is Off, and
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

  constructor(
    private readonly api: API,
    private readonly log: Logger,
    private readonly client: Pick<GatewayClient, 'setEufyMode'>,
    accessory: PlatformAccessory,
    private readonly cameraName: string,
    private readonly gatewayCamera: string,
  ) {
    const { Service, Characteristic } = api.hap
    this.service = accessory.getService(Service.SecuritySystem) ?? accessory.addService(Service.SecuritySystem, `${cameraName} eufy mode`)
    this.service.getCharacteristic(Characteristic.SecuritySystemCurrentState)
      .setProps({ validValues: HOMEKIT_STATES })
      .onGet(() => this.current())
    this.service.getCharacteristic(Characteristic.SecuritySystemTargetState)
      .setProps({ validValues: HOMEKIT_STATES })
      .onGet(() => this.current())
      .onSet(value => this.switchTo(value as number))
  }

  // HomeKit asks: the last known mode, at once. Until the gateway has told it (a moment after
  // startup), Off: a failing read would mark the whole camera as not responding.
  private current(): number {
    return this.mode ? homeKitStateFor(this.mode) : HOMEKIT.off
  }

  // The camera's eufy mode, as the gateway reports it (startup, then every 30 s).
  show(mode: EufyMode | null | undefined): void {
    if (!mode || mode === this.mode) {
      return
    }
    const first = this.mode === null
    this.mode = mode
    const state = homeKitStateFor(mode)
    const { Characteristic } = this.api.hap
    this.service.updateCharacteristic(Characteristic.SecuritySystemTargetState, state)
    this.service.updateCharacteristic(Characteristic.SecuritySystemCurrentState, state)
    const shown = mode === 'home' || mode === 'away' || mode === 'disarmed' ? '' : ` (shown in HomeKit as ${state === HOMEKIT.off ? 'Off' : 'Away'})`
    this.log.info(`eufy mode ${eufyModeLabel(mode)}${first ? '' : ' (switched elsewhere)'}${shown}.`, this.cameraName)
  }

  private async switchTo(state: number): Promise<void> {
    const mode = eufyModeFor(state)
    if (!mode) {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST)
    }
    try {
      await this.client.setEufyMode(this.gatewayCamera, mode)
      this.mode = mode
      this.log.info(`eufy mode ${eufyModeLabel(mode)} (from HomeKit).`, this.cameraName)
      this.service.updateCharacteristic(this.api.hap.Characteristic.SecuritySystemCurrentState, homeKitStateFor(mode))
    } catch (error) {
      this.log.warn(`Could not switch the eufy mode to ${eufyModeLabel(mode)}: ${(error as Error).message}`, this.cameraName)
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
    }
  }
}
