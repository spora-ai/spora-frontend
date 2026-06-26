# Spora Frontend

The prebuilt Vue 3 admin UI for [Spora](https://github.com/spora-ai/spora-core), shipped as a Composer package of type `spora-frontend`.

## What this is

A decoupled, standalone Vue + Vite + Tailwind + radix-vue SPA that lives in its own repository and gets distributed as a **prebuilt artifact** to operator installs (see [spora-ai/spora](https://github.com/spora-ai/spora)). Operators do **not** need Node — `composer install spora-ai/spora-frontend` drops the compiled `dist/` into `public/dist/` via [`spora-ai/installer ^1.2`](https://github.com/spora-ai/spora-installer).

This repository is the source of truth for the UI. The Composer's `dist.url` points at GitHub Release assets produced by the `build-and-release` workflow (see `.github/workflows/ci.yml`).

## Layout

```
frontend/
├── src/                # Vue 3 SPA source
│   ├── apps/           # Feature apps (plugins, memories, settings, …)
│   ├── components/     # Shared components
│   ├── composables/    # Vue composables
│   ├── stores/         # Pinia stores
│   └── …
├── public/             # Static assets bundled into the build
├── tests/              # Vitest specs
├── vite.config.ts      # build.outDir: 'dist' (consumed by spora-ai/installer)
└── package.json
```

## Local development

The operator install at `spora-ai/spora` uses a two-terminal dev workflow:

```bash
git clone https://github.com/spora-ai/spora-frontend
git clone https://github.com/spora-ai/spora      ../spora
cd ../spora
composer require spora-ai/spora-frontend --path=../spora-frontend
composer install
composer dev          # Terminal 1: PHP on http://localhost:8080
```

In a second terminal, start Vite from the path-installed frontend:

```bash
cd ../spora/vendor/spora-ai/spora-frontend
npm install            # first time only
npm run dev            # Terminal 2: Vite on http://localhost:5173
```

Vite's `server.proxy['/api']` forwards `/api/*` to the PHP server. Visit http://localhost:5173 for HMR; the API lives at http://localhost:8080/api/*.

Edit a `.vue` file here → Vite HMR triggers → UI updates without a reload.

## Production build

Tagging `v*` (e.g. `v0.1.0`) on `main` triggers the `build-and-release` workflow which:

1. Runs `npm ci && npm run build`.
2. Packages `dist/` into `spora-frontend-{tag}.tar.gz` (with a top-level `spora-frontend-{tag}/` directory).
3. Creates a GitHub Release with the tarball attached.

`spora-ai/installer` consumes that tarball as `dist.url` and routes its contents into the operator's `public/dist/`.

## Build locally without releasing

```bash
npm install
npm run build          # outputs dist/
npm run lint
npm test               # Vitest, 1471 specs
npm run test:coverage  # Vitest with v8 coverage
```

## How it integrates with Spora

| Layer | Repo | Purpose |
|---|---|---|
| Framework | [spora-ai/spora-core](https://github.com/spora-ai/spora-core) | PHP framework, plugin system, agents, recipes, drivers |
| Operator install | [spora-ai/spora](https://github.com/spora-ai/spora) | What operators `composer create-project`. Pulls core + this repo + installer |
| Prebuilt UI | **this repo** | Vue SPA source → prebuilt `dist/` → Composer `spora-frontend` package |
| Composer routing | [spora-ai/installer](https://github.com/spora-ai/spora-installer) | Routes `spora-frontend` packages → `public/dist/` |
| Plugin template | [spora-ai/spora-plugin-skeleton](https://github.com/spora-ai/spora-plugin-skeleton) | Use-this-template for plugin authors |

## License

MIT