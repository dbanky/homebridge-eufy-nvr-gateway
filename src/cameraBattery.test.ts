import type { API, PlatformAccessory } from 'homebridge'

import { describe, expect, it, vi } from 'vitest'

import { CameraBattery } from './cameraBattery.js'

function fakeHomeKit(existing = false) {
  const updates: Array<[string, number]> = []
  const added: string[] = []
  const nameOf = (c: unknown) => (typeof c === 'string' ? c : (c as { label: string }).label)
  const service = { updateCharacteristic: (c: unknown, value: number) => updates.push([nameOf(c), value]) }
  const api = {
    hap: {
      Service: { Battery: 'battery' },
      Characteristic: {
        BatteryLevel: 'level',
        StatusLowBattery: { label: 'low', BATTERY_LEVEL_NORMAL: 0, BATTERY_LEVEL_LOW: 1 },
        ChargingState: { label: 'charging', NOT_CHARGING: 0 },
      },
    },
  } as unknown as API
  const accessory = {
    getService: () => (existing ? service : undefined),
    addService: (_type: string, name: string) => {
      added.push(name)
      return service
    },
  } as unknown as PlatformAccessory
  return { api, accessory, updates, added }
}
const log = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) as any

describe('a camera\'s battery in HomeKit', () => {
  it('appears only once the gateway reports a level (mains-powered cameras report none)', () => {
    const { api, accessory, added, updates } = fakeHomeKit()
    const battery = new CameraBattery(api, log(), accessory, 'Garden')
    battery.show(null)
    battery.show(undefined)
    expect(added).toEqual([])
    battery.show(80)
    expect(added).toEqual(['Garden Battery'])
    expect(updates).toEqual([['level', 80], ['low', 0], ['charging', 0]])
  })

  it('is added once, and follows the level', () => {
    const { api, accessory, added, updates } = fakeHomeKit()
    const battery = new CameraBattery(api, log(), accessory, 'Garden')
    battery.show(80)
    battery.show(80) // unchanged: nothing to update
    battery.show(79)
    expect(added).toHaveLength(1)
    expect(updates.filter(([name]) => name === 'level')).toEqual([['level', 80], ['level', 79]])
  })

  it('says low below 15 %, and warns once when it gets there', () => {
    const { api, accessory, updates } = fakeHomeKit()
    const l = log()
    const battery = new CameraBattery(api, l, accessory, 'Garden')
    battery.show(15)
    expect(updates.at(-2)).toEqual(['low', 0])
    battery.show(14)
    expect(updates.at(-2)).toEqual(['low', 1])
    battery.show(13)
    expect(l.warn).toHaveBeenCalledTimes(1)
    expect(l.warn).toHaveBeenCalledWith('Battery low: 14 %.', 'Garden')
  })

  it('keeps a Battery service from an earlier start, and rounds odd values into 0–100', () => {
    const { api, accessory, added, updates } = fakeHomeKit(true)
    const battery = new CameraBattery(api, log(), accessory, 'Garden')
    battery.show(101.4)
    expect(added).toEqual([])
    expect(updates[0]).toEqual(['level', 100])
    battery.show(-3)
    expect(updates.filter(([name]) => name === 'level').at(-1)).toEqual(['level', 0])
  })
})
