# Development

```sh
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

The app starts with synthetic data because Nessie and speech credentials are not present. Use the packaged `demo/checkout.html` as a harmless checkout surface. Set `FLICKY_DATA_MODE=recorded-sandbox` and `FLICKY_SNAPSHOT_PATH` only with an explicitly labeled recording. Live Nessie is disabled until its contract and credentials are verified.

Renderer code receives only validated preload methods. The local service owns snapshots, session memory and provider secrets. `src/domain` contains all money arithmetic and uses integer cents.
