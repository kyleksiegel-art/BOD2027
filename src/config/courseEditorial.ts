// Static editorial layer for the Course Detail pages — the "Golf Digest feature" half
// of the page. This is INTENTIONALLY separate from the scoring/database data (courses,
// tees, holes): it is hand-written travel copy and local photography, keyed by the same
// `courseSlug()` the round-accent system uses (src/lib/format.ts). Nothing here feeds
// scoring or money; it is presentation only.
//
// PHOTOGRAPHY: use LOCAL assets only (the app must work offline). Drop a source photo at
// public/assets/courses/<slug>/hero.jpg (≥1600px wide, landscape), then run
//   npm i --no-save sharp && node scripts/gen-course-images.mjs
// to emit the responsive AVIF/WebP derivatives the page prefers. Until a hero exists the
// page renders a graceful typographic fallback in the course's accent color — no broken
// <img>, no stock photo. `heroImage`/hole `image` are the folder slug + base name the
// component expands into /assets/courses/<heroImage>/<name>.{avif,webp,jpg}; leave them
// undefined to get the fallback.
//
// COPY: hole-level facts are verified against reliable sources before being written here
// (Streamsong official course material, architect/course descriptions, reputable golf
// publications). Do not invent strategy or course features. For a course whose hole data
// is not yet public (Bone Valley), holesToKnow is left empty and the page shows a tasteful
// "still under wraps" note instead of guessed content.

export type CourseSlug = 'red' | 'black' | 'blue' | 'bone'

export interface HoleToKnow {
  hole: number
  title: string
  description: string
  /** Optional local image base name inside the course folder (e.g. 'hole-16'). */
  image?: string
  imageAlt?: string
}

export interface CourseEditorial {
  /** Course folder slug under public/assets/courses/ AND the base name of the hero set
   *  (we expect <slug>/hero.{avif,webp,jpg}). Undefined ⇒ typographic fallback. */
  heroImage?: string
  heroAlt?: string
  /** One strong sentence: what makes THIS course different from the others we play. */
  tagline: string
  /** Optional short editorial paragraph. Omit when the DB description already says it. */
  summary?: string
  holesToKnow: HoleToKnow[]
}

export const COURSE_EDITORIAL: Record<CourseSlug, CourseEditorial> = {
  red: {
    // Hero: public/assets/courses/red/hero.jpg (aerial of the Red course + clubhouse at
    // golden hour, supplied by Kyle). The page uses hero.jpg immediately; run
    // `npm i --no-save sharp && node scripts/gen-course-images.mjs` to emit the responsive
    // AVIF/WebP derivatives it prefers. Falls back to the accent plate if the file is absent.
    heroImage: 'red',
    heroAlt: 'Streamsong Red — aerial over the dunes and clubhouse at golden hour',
    tagline:
      'Wide corridors, bold angles and enormous sandy waste areas reward choosing the right side of the fairway rather than simply finding it.',
    // The DB description covers the SETTING (reclaimed phosphate-mine duneland); the tagline
    // covers STRATEGY. They don't overlap, so no summary is needed here — the page shows the
    // DB description on its own beneath the tagline.
    holesToKnow: [
      {
        hole: 8,
        title: 'The narrowest invitation.',
        description:
          'A short par 3 to a reverse-S green over 60 yards deep but as little as 8 wide, ringed by sandbelt bunkering. Club and spin decide it, not distance — anything mis-flighted slides off the wrong tier.',
      },
      {
        hole: 15,
        title: 'Pick your side of the sand.',
        description:
          'One of the deepest waste bunkers on the course runs the entire left side. Hug it for the ideal angle in; bail out right and the green — falling hard right to left — throws your ball away.',
      },
      {
        hole: 16,
        title: 'Biarritz over the water.',
        description:
          "Coore & Crenshaw's modern Biarritz — a green nearly 60 yards long with a deep swale swallowing anything short, all carried over water. Miss the right shelf and par is a real two-putt test.",
      },
    ],
  },
  // Blue / Black filled in when we apply the template to them; Bone Valley stays empty
  // (no verified hole data) so the page shows the "still under wraps" note.
  blue: {
    heroImage: undefined,
    heroAlt: 'Streamsong Blue — Tom Doak duneland',
    tagline: '',
    holesToKnow: [],
  },
  black: {
    heroImage: undefined,
    heroAlt: 'Streamsong Black — Hanse & Wagner big-scale duneland',
    tagline: '',
    holesToKnow: [],
  },
  bone: {
    heroImage: undefined,
    heroAlt: 'Bone Valley — David McLay Kidd',
    tagline: '',
    holesToKnow: [],
  },
}
