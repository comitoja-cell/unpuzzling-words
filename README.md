# Unpuzzling Words

Slide the tiles to spell all 13 words at once. A word puzzle by Games Over Coffee.

Plain HTML/CSS/JS, no build step. Open `index.html` in a browser, or host the folder as a static site.

## Files

| File | What it is |
|---|---|
| `index.html` | Page structure: masthead, board, keyboard reference, ad slots, how-to-play, overlays |
| `styles.css` | All styling. Design tokens live in `:root` at the top |
| `themes.js` | Theme data: words and the exact tile inventory per theme |
| `game.js` | Game logic: shuffle, moves, undo, word detection, win state, sounds, keys |

## Rules (as implemented)

- 8×8 board, 60 letter tiles, 4 empty spaces. One tile moves at a time.
- A word counts when it reads left→right in a row or top→bottom in a column, anywhere on the board. Words may share letters.
- Any arrangement showing all 13 words wins. Nothing locks; moving a letter out un-spells the word.
- Each game is a fresh random shuffle. With four empty spaces every arrangement is reachable, so every shuffle is solvable. A forward-only solution for the coffee tile set was verified by search.

## Keys

| Key | Action |
|---|---|
| Arrows / WASD | Move the glowing empty space (the tile in its way slides over). Switchable to "move the tile" in settings |
| Tab / Space | Next empty space (Shift+Tab: previous) |
| 1–4 | Jump to that empty space |
| Z / Backspace | Undo |
| L | Hints on/off |
| M | Sound on/off |
| N N | New puzzle |
| ? | Keys & rules |

## Adding a theme

Copy the `coffee` block in `themes.js`, set `words`, set `tiles` to the exact 60-letter inventory, and set `available: true`. Verify the inventory can spell every word at once (a crossword-style layout with shared letters) before shipping it.

## Ads

Three reserved slots in `index.html` carry `data-ad="rail-left" | "square" | "banner"`. Replace each placeholder's inner markup with your ad network's snippet once approved. Sizes: 160×600, 300×250, 728×90 (320×50 on phones).

## Deploy

Any static host works: GitHub Pages, Netlify, Vercel, Cloudflare Pages. Point it at the repo root.

## Mobile app (later)

Wrap this folder with Capacitor for iOS/Android, add touch swipe handling in `game.js`, and swap the ad slots for AdMob.
