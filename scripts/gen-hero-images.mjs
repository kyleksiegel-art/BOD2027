// Generate responsive hero derivatives (AVIF + WebP) from the source photo.
// One-time / re-runnable: outputs to public/assets/hero/. The original
// public/assets/hero.jpg stays as the <img> fallback for browsers without AVIF/WebP.
//
// `sharp` is NOT a project dependency (it broke Netlify's `npm ci`), so install it
// on demand just for this run — the generated images are committed, so the build
// itself never needs sharp:
//
//   npm i --no-save sharp && node scripts/gen-hero-images.mjs
//
// Widths are capped at the source's native width (1600) — never upscale.
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'public/assets/hero.jpg')
const outDir = join(root, 'public/assets/hero')

const WIDTHS = [640, 1080, 1600]

await mkdir(outDir, { recursive: true })
const meta = await sharp(src).metadata()
console.log(`source ${meta.width}×${meta.height}`)

for (const w of WIDTHS) {
  if (w > meta.width) continue
  const base = sharp(src).resize({ width: w })
  await base
    .clone()
    .avif({ quality: 50, effort: 5 })
    .toFile(join(outDir, `hero-${w}.avif`))
  await base
    .clone()
    .webp({ quality: 74 })
    .toFile(join(outDir, `hero-${w}.webp`))
  console.log(`wrote hero-${w}.avif + hero-${w}.webp`)
}
console.log('done')
