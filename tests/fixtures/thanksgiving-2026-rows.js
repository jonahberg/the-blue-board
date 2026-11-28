// Thanksgiving Day 2026 (Nov 26), as production stored it: every ops_briefs row from noon PT to the
// small hours of Friday whose air.normal fact read the day's schedule, from collection.airSchedule.
// [id, generated_at (UTC), United flights in the air, the usual in the air (7-day median at that
// wall clock), hub departures scheduled in the four hours to then, the usual for that count].
//
// What production published: rows 871 and 873 to 876 read "watch" from the flat 10-point band
// (v1.31.3); from row 880 today's scheduled count was under 40% of the usual (today_too_thin), so
// the holiday fallback capped the tone at calm, and rows 886 to 890 published "Far fewer United
// flights are in the air than usual right now." (887 and 888 at watch from Washington Dulles at 60%
// on time with the index at 30.8, the others calm). Row 891 (10:10 PM PT) is past Central midnight:
// "the morning after Thanksgiving Day", 34% short, not capped.

/** @type {Array<[number, string, number, number, number, number]>} */
export const THANKSGIVING_2026_ROWS = [
  [858, '2026-11-26T20:00:04Z', 505, 669, 605, 718],
  [859, '2026-11-26T20:10:04Z', 489, 655, 603, 719],
  [860, '2026-11-26T20:30:04Z', 466, 618, 602, 732],
  [861, '2026-11-26T20:40:04Z', 458, 627, 589, 735],
  [862, '2026-11-26T21:10:04Z', 432, 658, 534, 705],
  [863, '2026-11-26T21:20:04Z', 421, 655, 524, 707],
  [864, '2026-11-26T21:30:04Z', 405, 652, 516, 701],
  [865, '2026-11-26T21:40:04Z', 393, 656, 510, 703],
  [866, '2026-11-26T21:50:04Z', 374, 649, 497, 701],
  [867, '2026-11-26T22:30:04Z', 307, 647, 392, 641],
  [868, '2026-11-26T22:40:04Z', 310, 652, 386, 660],
  [869, '2026-11-26T22:50:04Z', 299, 659, 364, 649],
  [870, '2026-11-26T23:00:04Z', 289, 664, 354, 654],
  [871, '2026-11-26T23:10:04Z', 281, 680, 354, 660], // production: watch
  [872, '2026-11-26T23:20:04Z', 296, 687, 352, 668],
  [873, '2026-11-26T23:50:04Z', 267, 678, 344, 681], // production: watch
  [874, '2026-11-27T00:00:04Z', 263, 673, 346, 695], // production: watch
  [875, '2026-11-27T00:10:04Z', 251, 673, 338, 686], // production: watch
  [876, '2026-11-27T00:20:04Z', 241, 654, 332, 697], // production: watch
  [877, '2026-11-27T00:30:04Z', 235, 645, 307, 703],
  [878, '2026-11-27T00:40:04Z', 243, 658, 300, 707],
  [879, '2026-11-27T00:50:04Z', 240, 655, 284, 702],
  [880, '2026-11-27T01:00:04Z', 240, 673, 274, 720], // schedule too thin from here: the holiday fallback
  [881, '2026-11-27T01:10:04Z', 240, 678, 258, 711],
  [882, '2026-11-27T01:20:04Z', 226, 703, 249, 699],
  [883, '2026-11-27T02:00:04Z', 207, 609, 228, 697],
  [884, '2026-11-27T02:10:04Z', 196, 573, 225, 710],
  [885, '2026-11-27T03:00:04Z', 186, 518, 130, 673],
  [886, '2026-11-27T03:40:04Z', 160, 491, 120, 706], // production: "Far fewer…", calm
  [887, '2026-11-27T03:50:04Z', 174, 488, 118, 710], // production: "Far fewer…", watch (Dulles 60%, index 30.8)
  [888, '2026-11-27T04:20:04Z', 162, 479, 92, 665], // production: the same
  [889, '2026-11-27T05:00:04Z', 145, 344, 58, 488], // production: "Far fewer…", calm
  [890, '2026-11-27T05:20:04Z', 136, 276, 51, 474], // production: "Far fewer…", calm
  [891, '2026-11-27T06:10:04Z', 124, 187, 40, 385], // "the morning after Thanksgiving Day", not capped, 34% short
];

/** The payloads the brief's fact builder reads for one row: the live count, the usual, the schedule. */
export function rowSources([, , airborne, usualAir, schedToday, schedUsual]) {
  return {
    air: { airborne, starlink: null },
    airNormal: { median: usualAir, days: 7 },
    airSchedule: { today: schedToday, prior: Array.from({ length: 7 }, () => schedUsual) },
  };
}
