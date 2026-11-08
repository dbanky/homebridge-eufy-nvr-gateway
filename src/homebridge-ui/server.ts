import type { CameraConfig } from '../settings.js'

import fs from 'node:fs'

import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils'

import { cameraConfigFor, discover } from '../discovery.js'
import { PLUGIN_NAME } from '../settings.js'

class PluginUiServer extends HomebridgePluginUiServer {
  constructor() {
    super()
    /*
      A native method getCachedAccessories() was introduced in config-ui-x v4.37.0
      The following is for users who have a lower version of config-ui-x
    */
    this.onRequest('getCachedAccessories', () => {
      try {
        const plugin = PLUGIN_NAME
        const devicesToReturn = []

        // The path and file of the cached accessories
        const accFile = `${this.homebridgeStoragePath}/accessories/cachedAccessories`

        // Check the file exists
        if (fs.existsSync(accFile)) {
          // read the cached accessories file
          const cachedAccessories: any[] = JSON.parse(fs.readFileSync(accFile, 'utf8'))

          cachedAccessories.forEach((accessory: any) => {
            // Check the accessory is from this plugin
            if (accessory.plugin === plugin) {
              // Add the cached accessory to the array
              devicesToReturn.push(accessory.accessory as never)
            }
          })
        }
        // Return the array
        return devicesToReturn
      } catch {
        // Just return an empty accessory list in case of any errors
        return []
      }
    })
    /*
      The settings page asks for a gateway's cameras here: the page runs in the browser, which can't
      call the gateway itself. Payload: { gateway: { url, username, password, rtspUsername,
      rtspPassword }, cameras: [the cameras in the current config] }. Answer: the gateway, and for
      each of its cameras what was discovered and the camera config to save.
    */
    this.onRequest('/discover', async (payload: { gateway?: Record<string, string>, cameras?: CameraConfig[] }) => {
      try {
        const discovery = await discover(payload.gateway ?? {})
        const configured = (payload.cameras ?? []).filter(camera => camera.gatewayCamera)
        return {
          ...discovery,
          cameras: discovery.cameras.map((camera) => {
            const previous = configured.find(c => c.gatewayCamera === camera.name)
            return {
              discovered: camera,
              config: cameraConfigFor(camera, previous),
              // First setup: every camera. Later: the ones already added, new ones off.
              included: configured.length === 0 || !!previous,
            }
          }),
        }
      } catch (error) {
        throw new RequestError((error as Error).message, { status: 400 })
      }
    })
    this.ready()
  }
}

function startPluginUiServer(): PluginUiServer {
  return new PluginUiServer()
}

startPluginUiServer()
