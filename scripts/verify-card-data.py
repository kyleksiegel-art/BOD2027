#!/usr/bin/env python3
"""Phase 5B — the seeded course cards, checked number by number against the printed ones.

The brief said "Black has five par 3s ... do not correct this." The printed 2021 scorecards
say four par 3s and five par 5s. Rather than settle that by eye, this transcribes all three
cards and diffs every value against the database: 54 hole pars, 54 stroke indexes, 12 tee
rating/slope/par/total rows, and 216 hole yardages.

It checks the TRANSCRIPTION first — each nine's pars and yardages must add up to the Out/In/
Total printed on the card, and each stroke-index row must be a 1-18 permutation — so a
typo here fails as a transcription error rather than being blamed on the seed.

Source: Streamsong Resort official 2021 scorecards (Red / Blue / Black), supplied by Kyle
2026-08-17. Same documents cited by supabase/migrations/20260812100400_seed_core.sql and
src/lib/scoring/__fixtures__/streamsong.ts.

Run with a local Supabase up:  python3 scripts/verify-card-data.py
"""
# Transcribed by eye from the resort's 2021 scorecards (the PDFs Kyle supplied),
# then diffed against the seeded database. Printed Out/In/Total are included so the
# transcription checks itself before it is used to judge the seed.
CARDS = {
 'Streamsong Red': dict(
   par=[4,5,4,4,4,3,5,3,4, 4,4,4,5,3,4,3,4,5], out_par=36, in_par=36, total_par=72,
   si=[4,2,14,16,6,18,12,10,8, 9,5,3,15,11,1,7,13,17],
   tees={
    'Green': ([447,555,404,330,453,185,527,147,312, 486,423,500,535,181,474,208,403,540],3360,3750,7110,74.1,137),
    'Black': ([417,508,391,312,344,143,521,119,271, 431,408,472,508,166,453,184,384,505],3026,3511,6537,71.6,132),
    'Silver':([410,461,340,290,328,128,502,111,257, 385,397,450,451,150,402,160,343,443],2827,3181,6008,69.5,124),
    'Gold':  ([358,371,252,271,240,112,396,98,215, 278,275,340,427,111,291,103,317,406],2313,2548,4861,64.7,113)}),
 'Streamsong Blue': dict(
   par=[4,5,4,4,3,4,3,4,5, 3,4,4,4,5,4,3,5,4], out_par=36, in_par=36, total_par=72,
   si=[14,10,8,4,16,18,12,2,6, 15,1,11,17,9,7,13,5,3],
   tees={
    'Green': ([338,554,418,442,157,345,203,454,575, 187,487,408,312,545,446,237,690,478],3486,3790,7276,74.0,134),
    'Black': ([330,530,370,417,121,317,188,414,541, 161,454,390,293,510,398,215,590,453],3228,3464,6692,71.8,130),
    'Silver':([330,516,359,369,115,295,176,338,510, 129,427,351,279,489,357,188,525,439],3008,3184,6192,69.5,127),
    'Gold':  ([289,459,339,325,102,267,97,308,453, 103,386,317,247,452,341,165,498,364],2639,2873,5512,66.4,113)}),
 'Streamsong Black': dict(
   par=[5,4,4,5,3,4,3,4,4, 5,4,5,4,4,3,4,3,5], out_par=36, in_par=37, total_par=73,
   si=[12,16,4,2,6,18,14,8,10, 11,3,7,9,15,17,1,13,5],
   tees={
    'Green': ([573,361,480,601,211,342,178,427,450, 548,463,571,430,298,133,463,205,586],3623,3697,7320,74.7,135),
    'Black': ([508,326,423,581,177,321,158,408,408, 524,395,531,409,286,131,442,189,530],3310,3437,6747,72.0,130),
    'Silver':([466,309,394,550,158,299,135,377,360, 502,378,510,368,261,110,400,154,495],3048,3178,6226,69.5,125),
    'Gold':  ([420,276,306,450,135,252,103,357,317, 434,320,404,308,242,78,323,124,431],2616,2664,5280,65.1,116)}),
}

problems = []

# 1. Does the transcription agree with the card's own printed subtotals?
for course, c in CARDS.items():
    if sum(c['par'][:9]) != c['out_par'] or sum(c['par'][9:]) != c['in_par'] or sum(c['par']) != c['total_par']:
        problems.append(f'TRANSCRIPTION {course}: par subtotals do not match the printed Out/In/Total')
    if sorted(c['si']) != list(range(1,19)):
        problems.append(f'TRANSCRIPTION {course}: stroke indexes are not a 1-18 permutation')
    for tee,(y,o,i,t,_r,_s) in c['tees'].items():
        if sum(y[:9]) != o or sum(y[9:]) != i or o+i != t:
            problems.append(f'TRANSCRIPTION {course}/{tee}: yardages do not match printed {o}/{i}/{t}')

import json,subprocess
def q(sql):
    out = subprocess.run(['docker','exec','-i','supabase_db_BOD2027','psql','-U','postgres','-d','postgres','-tAc',sql],
                         capture_output=True, text=True)
    return [l for l in out.stdout.strip().split('\n') if l]

# 2. Does the seeded database agree with the card?
for course, c in CARDS.items():
    rows = q(f"select h.hole_number, h.par, h.stroke_index from public.holes h join public.courses c on c.id=h.course_id where c.name='{course}' order by 1")
    for line in rows:
        n, par, si = line.split('|')
        n = int(n)
        if int(par) != c['par'][n-1]:
            problems.append(f'DB {course} hole {n}: par {par} != card {c["par"][n-1]}')
        if int(si) != c['si'][n-1]:
            problems.append(f'DB {course} hole {n}: stroke index {si} != card {c["si"][n-1]}')

    for tee,(y,_o,_i,total,rating,slope) in c['tees'].items():
        trow = q(f"select t.rating, t.slope, t.par, t.total_yardage from public.tees t join public.courses c on c.id=t.course_id where c.name='{course}' and t.name='{tee}'")
        if not trow:
            problems.append(f'DB {course}: no {tee} tee'); continue
        r, s, p, ty = trow[0].split('|')
        if float(r) != rating: problems.append(f'DB {course}/{tee}: rating {r} != card {rating}')
        if int(s) != slope:    problems.append(f'DB {course}/{tee}: slope {s} != card {slope}')
        if int(p) != c['total_par']: problems.append(f'DB {course}/{tee}: par {p} != card {c["total_par"]}')
        if int(ty) != total:   problems.append(f'DB {course}/{tee}: total yardage {ty} != card {total}')

        yrows = q(f"""select h.hole_number, y.yardage from public.hole_yardages y
                        join public.holes h on h.id=y.hole_id
                        join public.tees  t on t.id=y.tee_id
                        join public.courses c on c.id=h.course_id
                       where c.name='{course}' and t.name='{tee}' order by 1""")
        if len(yrows) != 18:
            problems.append(f'DB {course}/{tee}: {len(yrows)} hole yardages, expected 18')
        for line in yrows:
            n, yd = line.split('|')
            n = int(n)
            if int(yd) != y[n-1]:
                problems.append(f'DB {course}/{tee} hole {n}: yardage {yd} != card {y[n-1]}')

print(f'{len(problems)} problem(s)')
for p in problems: print(' -', p)

for course, c in CARDS.items():
    p3 = sum(1 for x in c['par'] if x==3); p4 = sum(1 for x in c['par'] if x==4); p5 = sum(1 for x in c['par'] if x==5)
    print(f'{course:18} card: {p3} par 3s, {p4} par 4s, {p5} par 5s, par {sum(c["par"])}')
