// A camera's battery in HomeKit: a Battery service on the camera's accessory, for cameras that report
// a battery level through the gateway (mains-powered ones report none and get no service). Its level,
// and whether it charges (a cable or a solar panel; eufy NVR Gateway 0.7.0-beta.2 or later), come with
// the gateway's status (startup, then every 30 s), so nothing extra is asked for them.

import type { API, PlatformAccessory, Service } from 'homebridge'

import type { Logger } from './logger.js'

// Low battery below this, as the gateway's default "minBatteryPct": below it, only the doorbell or
// live view wakes the camera.
export const LOW_BATTERY_PCT = 15

export class CameraBattery {
  private service: Service | null = null
  private level: number | null = null
  private charging: boolean | null = null

  constructor(
    private readonly api: API,
    private readonly log: Logger,
    private readonly accessory: PlatformAccessory,
    private readonly cameraName: string,
  ) {
    // A Battery service from an earlier start: kept, its level follows below.
    this.service = accessory.getService(api.hap.Service.Battery) ?? null
  }

  // The level the gateway reports (0–100), or null when it reports none (mains power, not known yet),
  // and whether the battery charges (null when the gateway doesn't say: shown as not charging).
  show(level: number | null | undefined, charging?: boolean | null): void {
    if (typeof level !== 'number' || !Number.isFinite(level)) {
      return
    }
    const percent = Math.max(0, Math.min(100, Math.round(level)))
    const isCharging = charging === true
    if (percent === this.level && isCharging === this.charging) {
      return
    }
    const { Service, Characteristic } = this.api.hap
    if (!this.service) {
      this.service = this.accessory.addService(Service.Battery, `${this.cameraName} Battery`)
      this.log.info(`Battery ${percent} %: shown in HomeKit.`, this.cameraName)
    }
    const low = percent < LOW_BATTERY_PCT
    if (this.level !== null && low && this.level >= LOW_BATTERY_PCT) {
      this.log.warn(`Battery low: ${percent} %.`, this.cameraName)
    }
    if (this.charging !== null && isCharging !== this.charging) {
      this.log.debug(`Battery ${isCharging ? 'charging' : 'no longer charging'} (${percent} %).`, this.cameraName)
    }
    this.level = percent
    this.charging = isCharging
    this.service.updateCharacteristic(Characteristic.BatteryLevel, percent)
    this.service.updateCharacteristic(Characteristic.StatusLowBattery, low ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL)
    this.service.updateCharacteristic(Characteristic.ChargingState, isCharging ? Characteristic.ChargingState.CHARGING : Characteristic.ChargingState.NOT_CHARGING)
  }
}
