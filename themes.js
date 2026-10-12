/* Unpuzzling Words — theme data
   Each theme is self-contained: words, the exact 60-tile set, and copy.
   To add a theme: copy the coffee block, change words/tiles, set available:true.
   Rule of thumb: tiles.length must equal size*size - gaps (64 - 4 = 60). */

window.UW_THEMES = [
  {
    id: "coffee",
    name: "Coffee",
    tagline: "The original. 13 words, 60 tiles, 4 open spaces.",
    available: true,
    size: 8,
    gaps: 4,
    words: [
      "BEANS", "BREW", "CAFFEINE", "COFFEE", "ESPRESSO", "FILTER", "ICE",
      "LATTE", "MILK", "MOCHA", "MUG", "ROAST", "SUGAR"
    ],
    // Exact tile inventory from the version_2 sheet (60 tiles).
    tiles:
      "AAAAA" + "BB" + "CCC" + "EEEEEEEEE" + "FFFFF" + "GG" + "H" + "IIII" +
      "K" + "LLL" + "MMM" + "NN" + "OOOO" + "P" + "RRRR" + "SSSSS" + "TTT" +
      "UU" + "W",
    // Share-card emoji
    emoji: "☕"
  },
  { id: "farm",  name: "Farm Animals", available: false },
  { id: "space", name: "Outer Space",  available: false },
  { id: "jobs",  name: "Jobs",         available: false }
];
