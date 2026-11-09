// A camera's battery in HomeKit: a Battery service on the camera's accessory, for cameras that report
// a battery level through the gateway (mains-powered ones report none and get no service). Its level
// comes with the gateway's status (startup, then every 30 s), so nothing extra is asked for it.

import type { API, PlatformAccessory, Service } from 'homebridge'

import type { Logger } from './logger.js'

// Low battery below this, as the gateway's default "minBatteryPct": below it, only the doorbell or
// live view wakes the camera.
export const LOW_BATTERY_PCT = 15

export class CameraBattery {
  private service: Service | null = null
  private level: number | null = null

  constructor(
    private readonly api: API,
    private readonly log: Logger,
    private readonly accessory: PlatformAccessory,
    private readonly cameraName: string,
  ) {
    // A Battery service from an earlier start: kept, its level follows below.
    this.service = accessory.getService(api.hap.Service.Battery) ?? null
  }

  // The level the gateway reports (0–100), or null when it reports none (mains power, not known yet).
  show(level: number | null | undefined): void {
    if (typeof level !== 'number' || !Number.isFinite(level) || level === this.level) {
      return
    }
    const percent = Math.max(0, Math.min(100, Math.round(level)))
    const { Service, Characteristic } = this.api.hap
    if (!this.service) {
      this.service = this.accessory.addService(Service.Battery, `${this.cameraName} Battery`)
      this.log.info(`Battery ${percent} %: shown in HomeKit.`, this.cameraName)
    }
    const low = percent < LOW_BATTERY_PCT
    if (this.level !== null && low && this.level >= LOW_BATTERY_PCT) {
      this.log.warn(`Battery low: ${percent} %.`, this.cameraName)
    }
    this.level = percent
    this.service.updateCharacteristic(Characteristic.BatteryLevel, percent)
    this.service.updateCharacteristic(Characteristic.StatusLowBattery, low ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL)
    // The gateway doesn't report charging (not even for solar cameras).
    this.service.updateCharacteristic(Characteristic.ChargingState, Characteristic.ChargingState.NOT_CHARGING)
  }
}
