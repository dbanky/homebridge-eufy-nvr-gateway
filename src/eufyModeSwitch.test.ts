import type { API, PlatformAccessory } from 'homebridge'

import type { EufyMode } from './gateway.js'

import { describe, expect, it, vi } from 'vitest'

import { eufyModeFor, EufyModeSwitch, HOMEKIT, homeKitStateFor, offeredStates } from './eufyModeSwitch.js'

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

function setup(modes?: unknown[]) {
  const client = { setEufyMode: vi.fn(async (_camera: string, mode: EufyMode) => mode) }
  const homekit = fakeHomeKit()
  const modeSwitch = new EufyModeSwitch(homekit.api, log, client, homekit.accessory, 'Garden', 'garden', modes)
  return { ...homekit, client, modeSwitch }
}

describe('a camera\'s Eufy mode in HomeKit', () => {
  it('offers Home, Away and Off, no Night', () => {
    const { handlers, added } = setup()
    expect(added).toEqual(['Garden Eufy mode'])
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

  it('switches the camera\'s Eufy mode through the gateway', async () => {
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
    expect(log.info).toHaveBeenLastCalledWith('Eufy mode Custom 1 (switched elsewhere) (shown in HomeKit as Away).', 'Garden')
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
    expect(log.warn).toHaveBeenCalledWith('Could not switch the Eufy mode to Away: garden: station offline', 'Garden')
    await expect(handlers.target.set!(2)).rejects.toThrow('HAP -70410')
  })
})

describe('choosing which Eufy modes HomeKit offers', () => {
  it('offers all three by default, or the ones chosen, in HomeKit\'s order', () => {
    expect(offeredStates()).toEqual([0, 1, 3])
    expect(offeredStates(['disarmed', 'away'])).toEqual([1, 3])
    expect(offeredStates(['home', 'party'])).toEqual([0]) // unknown modes are ignored
    expect(offeredStates([])).toEqual([0, 1, 3]) // never none
  })

  it('the Home app offers only the chosen modes, but shows any current one', () => {
    const { handlers } = setup(['away', 'disarmed'])
    expect(handlers.target.props).toEqual({ validValues: [1, 3] })
    expect(handlers.current.props).toEqual({ validValues: [0, 1, 3] })
  })

  it('a mode set in the eufy app that isn\'t offered shows as current, never as the target', () => {
    const { modeSwitch, handlers, updates } = setup(['away', 'disarmed'])
    modeSwitch.show('away')
    modeSwitch.show('home')
    expect(handlers.current.get!()).toBe(0)
    expect(handlers.target.get!()).toBe(1) // the last offered one
    expect(updates.filter(([name]) => name === 'target')).toEqual([['target', 1]])
  })

  it('refuses a mode that isn\'t offered', async () => {
    const { handlers, client } = setup(['away', 'disarmed'])
    await expect(handlers.target.set!(HOMEKIT.home)).rejects.toThrow('HAP -70410')
    expect(client.setEufyMode).not.toHaveBeenCalled()
    await handlers.target.set!(HOMEKIT.away)
    expect(client.setEufyMode).toHaveBeenCalledWith('garden', 'away')
    expect(handlers.target.get!()).toBe(1)
  })

  it('starts with Off as the target when it is offered, else the first offered mode', () => {
    expect(setup().handlers.target.get!()).toBe(3)
    expect(setup(['home', 'away']).handlers.target.get!()).toBe(0)
  })
})
