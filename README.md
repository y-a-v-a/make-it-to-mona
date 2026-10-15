# Make It to Mona

A small browser game: you are a visitor in the crowded room where the Mona Lisa
hangs. Push your way through the crowd and touch the fence right in front of the
painting.

The whole game is a single `index.html` (HTML, CSS and JavaScript), rendered with
[Three.js](https://threejs.org/) loaded from a CDN.

## Play

Play online at <https://y-a-v-a.github.io/make-it-to-mona/>, or open `index.html` in a
browser (an internet connection is needed to load Three.js).

- Arrow keys: move
- R: restart
- Enter: play again after winning

## Tweaking

All tunable values live in the `CONFIG` object at the top of the script in
`index.html`, for example:

- `CROWD_SIZE_START`, `CROWD_SIZE_MAX`: visitors in the room when you arrive, and the most it will hold
- `CROWD_GROWTH_PER_MINUTE`: how quickly the room gets busier over time
- `NPC_SPEED`, `NPC_SPEED_VARIATION`: how fast visitors walk
- `PLAYER_SPEED`: how fast you walk
- `MASS_*`: how hard people are to push aside
- `WATCH_TIME_MIN`, `WATCH_TIME_MAX`: how long visitors stand at the fence

## Tests

The tests load the game in headless Chromium through Playwright, with a seeded
random generator and Three.js served from `node_modules`, so they run offline.

```sh
npm install
npx playwright install chromium   # once, if Playwright has no browser yet
npm test
```

## Deployment

`.github/workflows/pages.yml` runs the tests on every push and pull request. On
`main`, when the tests pass, it publishes `index.html` to GitHub Pages. This needs
Pages to be set to deploy from GitHub Actions (Settings > Pages > Source).

## License

[MIT](LICENSE)
