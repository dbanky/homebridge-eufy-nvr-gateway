import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// The settings page's markup (before its scripts): every tab's content must sit inside that tab's
// section, or it shows under every tab.
const markup = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8').split('<script>')[0]

// The ids of the <div> sections that contain the element with this id, outermost first.
function sectionsAround(id: string): string[] {
  const open: string[] = []
  for (const tag of markup.matchAll(/<div\b([^>]*)>|<\/div>|\bid="([^"]+)"/g)) {
    if (tag[0] === '</div>') {
      open.pop()
    } else if (tag[0].startsWith('<div')) {
      const own = /\bid="([^"]+)"/.exec(tag[1] ?? '')?.[1] ?? ''
      if (own === id) {
        return open.filter(Boolean)
      }
      open.push(own)
    } else if (tag[2] === id) {
      return open.filter(Boolean)
    }
  }
  throw new Error(`no element with id "${id}"`)
}

describe('the settings page markup', () => {
  it('closes every <div> it opens', () => {
    expect((markup.match(/<div\b/g) ?? []).length).toBe((markup.match(/<\/div>/g) ?? []).length)
  })

  it('keeps each tab\'s content inside its own section', () => {
    // The outermost section is the tab; boxes inside it (e.g. the stream login's) don't matter.
    for (const id of ['gwAddress', 'gwRtspUsername', 'cameraList', 'otherCameras']) {
      expect(sectionsAround(id)[0], id).toBe('pageSettings')
    }
    expect(sectionsAround('devicesTable')[0]).toBe('pageDevices')
    for (const page of ['pageIntro', 'pageDevices', 'pageSettings', 'pageSupport']) {
      expect(sectionsAround(page), page).toEqual([])
    }
  })
})
