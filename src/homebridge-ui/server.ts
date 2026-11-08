import type { CameraConfig } from '../settings.js'

import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils'

import { cameraConfigFor, discover } from '../discovery.js'

class PluginUiServer extends HomebridgePluginUiServer {
  constructor() {
    super()
    /*
      The settings page asks for a gateway's cameras here: the page runs in the browser, which can't
      call the gateway itself. Payload: { gateway: { url, rtspUsername, rtspPassword },, cameras: [the cameras in the current config] }. Answer: the gateway, and for
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
