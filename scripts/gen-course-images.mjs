// Generate responsive course-hero derivatives (AVIF + WebP) from each source photo.
// Mirrors scripts/gen-hero-images.mjs. One-time / re-runnable per course: for every
// public/assets/courses/<slug>/hero.jpg it finds, it writes hero-640/1080/1600 in AVIF
// and WebP beside it. The original hero.jpg stays as the <img> fallback for browsers
// without AVIF/WebP (and CourseDetail's own <picture> fallback path).
//
// `sharp` is NOT a project dependency (it broke Netlify's `npm ci`), so install it on
// demand just for this run — the generated images are committed, so the build itself
// never needs sharp:
//
//   npm i --no-save sharp && node scripts/gen-course-images.mjs
//
// Also handles optional hole photos: any hole-*.jpg in a course folder gets the same
// treatment. Widths are capped at each source's native width — never upscale.
import sharp from 'sharp'
import { readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename, extname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const coursesDir = join(root, 'public/assets/courses')

const WIDTHS = [640, 1080, 1600]

async function processImage(dir, file) {
  const src = join(dir, file)
  const base = basename(file, extname(file))
  const meta = await sharp(src).metadata()
  console.log(`  ${file}: source ${meta.width}×${meta.height}`)
  for (const w of WIDTHS) {
    if (w > meta.width) continue
    const img = sharp(src).resize({ width: w })
    await img.clone().avif({ quality: 50, effort: 5 }).toFile(join(dir, `${base}-${w}.avif`))
    await img.clone().webp({ quality: 74 }).toFile(join(dir, `${base}-${w}.webp`))
    console.log(`    wrote ${base}-${w}.avif + ${base}-${w}.webp`)
  }
}

let slugs = []
try {
  slugs = await readdir(coursesDir)
} catch {
  console.log('No public/assets/courses/ directory yet — nothing to do.')
  process.exit(0)
}

for (const slug of slugs) {
  const dir = join(coursesDir, slug)
  if (!(await stat(dir)).isDirectory()) continue
  console.log(`${slug}:`)
  const files = await readdir(dir)
  // Only the original source JPGs — never re-process our own derivatives.
  const sources = files.filter(
    (f) => /\.jpe?g$/i.test(f) && (f.startsWith('hero') || f.startsWith('hole-')) && !/-\d+\./.test(f),
  )
  if (sources.length === 0) console.log('  (no source hero.jpg / hole-*.jpg)')
  for (const f of sources) await processImage(dir, f)
}
console.log('done')
