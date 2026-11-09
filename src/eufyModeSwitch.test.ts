import type { API, PlatformAccessory } from 'homebridge'

import type { EufyMode } from './gateway.js'

import { describe, expect, it, vi } from 'vitest'

import { eufyModeFor, EufyModeSwitch, HOMEKIT, homeKitStateFor } from './eufyModeSwitch.js'

// A stand-in for HomeKit's security system service, recording handlers and updates.
function fakeHomeKit() {
  const handlers: Record<string, { get?: () => unknown, set?: (v: unknown) => Promise<void>, props?: unknown }> = {}
  const updates: Array<[string, number]> = []
  const characteristic = (name: string) => {
    handlers[name] ??= {}
    const c = {
      setProps: (props: unknown) => {
        handlers[name].props = props
        return c
      },
      onGet: (fn: () => unknown) => {
        handlers[name].get = fn
        return c
      },
      onSet: (fn: (v: unknown) => Promise<void>) => {
        handlers[name].set = fn
        return c
      },
    }
    return c
  }
  const service = {
    getCharacteristic: (name: string) => characteristic(name),
    updateCharacteristic: (name: string, value: number) => updates.push([name, value]),
  }
  class HapStatusError extends Error {
    constructor(public status: number) {
      super(`HAP ${status}`)
    }
  }
  const api = {
    hap: {
      Service: { SecuritySystem: 'security' },
      Characteristic: { SecuritySystemCurrentState: 'current', SecuritySystemTargetState: 'target' },
      HapStatusError,
      HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402, INVALID_VALUE_IN_REQUEST: -70410 },
    },
  } as unknown as API
  const added: string[] = []
  const accessory = {
    getService: () => undefined,
    addService: (_type: string, name: string) => {
      added.push(name)
      return service
    },
  } as unknown as PlatformAccessory
  return { api, accessory, handlers, updates, added }
}

const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } as any

function setup() {
  const client = { setEufyMode: vi.fn(async (_camera: string, mode: EufyMode) => mode) }
  const homekit = fakeHomeKit()
  const modeSwitch = new EufyModeSwitch(homekit.api, log, client, homekit.accessory, 'Garden', 'garden')
  return { ...homekit, client, modeSwitch }
}

describe('a camera\'s eufy mode in HomeKit', () => {
  it('offers Home, Away and Off, no Night', () => {
    const { handlers, added } = setup()
    expect(added).toEqual(['Garden eufy mode'])
    expect(handlers.target.props).toEqual({ validValues: [0, 1, 3] })
    expect(handlers.current.props).toEqual({ validValues: [0, 1, 3] })
  })

  it('maps Home, Away and Off to eufy\'s Home, Away and Disarmed', () => {
    expect([HOMEKIT.home, HOMEKIT.away, HOMEKIT.off].map(eufyModeFor)).toEqual(['home', 'away', 'disarmed'])
    expect(eufyModeFor(2)).toBeUndefined() // Night
  })

  it('shows eufy\'s Off as Off, and its other armed modes as Away', () => {
    expect((['home', 'away', 'disarmed', 'off'] as EufyMode[]).map(homeKitStateFor)).toEqual([0, 1, 3, 3])
    expect((['schedule', 'custom1', 'custom2', 'custom3', 'geo'] as EufyMode[]).map(homeKitStateFor)).toEqual([1, 1, 1, 1, 1])
  })

  it('switches the camera\'s eufy mode through the gateway', async () => {
    const { handlers, client, updates } = setup()
    await handlers.target.set!(HOMEKIT.off)
    expect(client.setEufyMode).toHaveBeenCalledWith('garden', 'disarmed')
    expect(updates.at(-1)).toEqual(['current', 3])
    expect(handlers.current.get!()).toBe(3)
  })

  it('shows the mode the gateway reports, also one switched in the eufy app', () => {
    const { modeSwitch, updates, handlers } = setup()
    modeSwitch.show('home')
    expect(handlers.current.get!()).toBe(0)
    modeSwitch.show('custom1')
    expect(updates.at(-1)).toEqual(['current', 1])
    expect(log.info).toHaveBeenLastCalledWith('eufy mode Custom 1 (switched elsewhere) (shown in HomeKit as Away).', 'Garden')
    updates.length = 0
    modeSwitch.show('custom1') // unchanged: nothing to update
    modeSwitch.show(null) // unknown: keep what it was
    expect(updates).toEqual([])
  })

  it('answers Off until the mode is known, never failing the camera', () => {
    const { handlers } = setup()
    expect(handlers.current.get!()).toBe(3)
  })

  it('tells HomeKit when the switch fails', async () => {
    const { handlers, client } = setup()
    client.setEufyMode.mockRejectedValue(new Error('garden: station offline'))
    await expect(handlers.target.set!(HOMEKIT.away)).rejects.toThrow('HAP -70402')
    expect(log.warn).toHaveBeenCalledWith('Could not switch the eufy mode to Away: garden: station offline', 'Garden')
    await expect(handlers.target.set!(2)).rejects.toThrow('HAP -70410')
  })
})
