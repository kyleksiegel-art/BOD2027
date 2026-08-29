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
    // Photography not yet supplied — see this file's header. Drop
    // public/assets/courses/red/hero.jpg and set heroImage: 'red' to switch on the photo.
    heroImage: undefined,
    heroAlt: 'Streamsong Red — Coore & Crenshaw duneland',
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
          'A short par 3 into a reverse-S green over 60 yards deep but as little as 8 yards wide from the back tees, ringed by sandbelt-style bunkering. Club and spin matter more than length — the green sheds anything not flighted to the right tier.',
      },
      {
        hole: 15,
        title: 'Pick your side of the sand.',
        description:
          'One of the largest, deepest waste bunkers on the course runs the whole left side. The bold line hugs it for the best angle in; bail right and the green — falling hard from right to left — pushes your ball away all afternoon.',
      },
      {
        hole: 16,
        title: 'Biarritz over the water.',
        description:
          "Coore & Crenshaw's modern Biarritz: a green nearly 60 yards long with a deep swale collecting anything short, all carried over water. Land on the wrong shelf and par becomes a genuine two-putt test.",
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
