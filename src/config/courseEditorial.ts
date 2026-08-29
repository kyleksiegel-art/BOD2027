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
  blue: {
    // Hero: the par-3 7th over water (Streamsong's own og:image for the Blue page).
    heroImage: 'blue',
    heroAlt: 'Streamsong Blue — the par-3 7th over water, dunes behind',
    tagline:
      'Tom Doak routes Blue over the same mined dunescape as Red, but bigger and bolder — high tees, huge greens, and heroic carries that ask you to commit.',
    // DB description covers the setting; tagline covers Doak's scale/character.
    holesToKnow: [
      {
        hole: 1,
        title: 'The highest point on the property.',
        description:
          'Blue opens from the tallest tee at Streamsong — a panoramic drop-shot view over the whole dunescape. A dramatic, downhill introduction that sets the scale of everything to come.',
      },
      {
        hole: 3,
        title: 'A true cape hole.',
        description:
          'Risk and reward off the tee: bite off as much of the diagonal carry as you dare for a short, open approach, or play safe and leave yourself a long one from the wrong angle.',
      },
      {
        hole: 7,
        title: 'The most photographed shot at Streamsong.',
        description:
          "Doak's all-world par 3 — a contoured punchbowl green nestled between water in front and towering dunes behind, reached by a walking bridge. Sister hole to Red's 16th, and the Blue's signature.",
      },
    ],
  },
  black: {
    // Hero: Streamsong's own og:image for the Black page (big-scale duneland).
    heroImage: 'black',
    heroAlt: 'Streamsong Black — Gil Hanse big-scale duneland',
    tagline:
      'Gil Hanse builds on the biggest scale of the three — vast fairways and enormous, wildly contoured greens (11,000+ sq ft) that reward running the ball and punish the timid.',
    holesToKnow: [
      {
        hole: 9,
        title: 'The Punchbowl.',
        description:
          'The course’s defining green — one of the largest, most undulating you will ever putt, sitting 8–10 feet below the ridge that rings it. Aim at the windmill off the tee, then fire into the funnel.',
      },
      {
        hole: 13,
        title: 'Two greens, one hole.',
        description:
          'A par 4 with two entirely separate greens in the spirit of Pine Valley’s 8th — the day’s pin decides your line off the tee, so look at the flag before you pull a club.',
      },
      {
        hole: 17,
        title: 'Under the oak.',
        description:
          'A par 3 tumbling downhill from a lone giant oak to the green, sand wrapping around the tree. One of the most photogenic — and most exposed — one-shotters on the property.',
      },
    ],
  },
  bone: {
    // Bone Valley (David McLay Kidd) — scorecard + hole detail not yet public. No hero photo
    // and no verified holes, so the page shows the accent-plate hero and the "under wraps"
    // note rather than guessed content. Fill in once the official course guide is published.
    heroImage: undefined,
    heroAlt: 'Bone Valley — David McLay Kidd',
    tagline: '',
    holesToKnow: [],
  },
}
