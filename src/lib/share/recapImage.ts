// Rasterise the round recap card to a PNG for the share sheet.
//
// modern-screenshot clones the DOM into an SVG <foreignObject> with computed styles inlined
// and paints it to a canvas, so the image is the card exactly as rendered — tokens, course
// accent, Fraunces axes and all. The self-hosted woff2 fonts are same-origin and get embedded.
// Elements marked `data-share-exclude` (the footer's buttons) are left out of the picture.
import { domToBlob } from 'modern-screenshot'

export const SHARE_EXCLUDE_ATTR = 'data-share-exclude'

export async function renderRecapImage(el: HTMLElement): Promise<Blob> {
  // A card with no layout (hidden tab, display:none ancestor) rasterises to a 2px-wide
  // ribbon of wrapped text. Refuse rather than share that; the tap path retries.
  if (el.offsetWidth < 200) throw new Error('recap card has no layout width')
  const ground = getComputedStyle(el).backgroundColor
  return domToBlob(el, {
    type: 'image/png',
    // 2× the CSS pixels: crisp on a phone, still a small file.
    scale: 2,
    backgroundColor: ground,
    filter: (node) => !(node instanceof HTMLElement && node.hasAttribute(SHARE_EXCLUDE_ATTR)),
    // The card's own rounded corners and shadow are on the element itself; keep the crop tight.
    style: { margin: '0', boxShadow: 'none' },
  })
}

export function recapImageFilename(courseName: string, roundNumber: number): string {
  const slug = courseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return `bod2027-r${roundNumber}-${slug}.png`
}

/** True where the share sheet accepts an image file (iOS 15+, Android Chrome). */
export function canShareFiles(file: File): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  )
}
