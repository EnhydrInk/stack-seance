# Stack Séance

Resurrecting HyperCard: describe a button in plain language and the card grows it. Flip any card to see — and edit — the HyperTalk script that actually runs.

**Live:** https://stack-seance.enhydrink.com

Built with [Kiro](https://kiro.dev) for Kiroween 2026. Work in progress.

## Run it locally

```sh
npm install
npm run dev        # the app, with Vite
npm test           # every test, including the fast-check properties
npm run typecheck
```

Every push to `main` runs the type check and the tests, builds the app and publishes it to GitHub Pages (`.github/workflows/deploy.yml`).

## Third-party assets

- [Pixelify Sans](https://github.com/eifetx/Pixelify-Sans) and [VT323](https://fonts.google.com/specimen/VT323), both under the SIL Open Font License 1.1, bundled through Fontsource.

All pixel art is drawn for this project.

## License

[MIT](LICENSE)
