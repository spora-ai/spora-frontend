# Releasing spora-frontend

This package is published on Packagist as `spora-ai/spora-frontend`. Releases use GitHub Releases for the asset tarball; Packagist indexes from the git tag, so the `dist.url` in the **tagged** `composer.json` must point at the correct asset.

## Release process

1. **Open a release prep PR** against `main`:
   - Bump `package.json` `version` to the next semver (e.g. `0.1.2`)
   - Update `composer.json` `dist.url` to the matching URL:
     ```
     https://github.com/spora-ai/spora-frontend/releases/download/v<VERSION>/spora-frontend-v<VERSION>.tar.gz
     ```
   - Update `CHANGELOG.md` (if present) and `README.md` if needed
2. **Merge the PR** to `main`.
3. **Tag the merge commit** from `main`:
   ```bash
   git checkout main && git pull --ff-only
   git tag v<VERSION>    # e.g. v0.1.2
   git push origin v<VERSION>
   ```
4. The `build-and-release` workflow fires:
   - Builds the asset
   - Verifies the tagged `composer.json`'s `dist.url` matches the tag (fails loudly if not)
   - Verifies the artifact contains only `dist/` contents (no source code, configs, or `node_modules`)
   - Creates the GitHub Release with the asset attached
5. Packagist auto-indexes the new tag within ~5 minutes.

## Release artifact shape

The GitHub Release asset (`spora-frontend-v<VERSION>.tar.gz`) contains **only the contents of `dist/`**, under a single versioned root directory that matches the tag:

```
spora-frontend-v<VERSION>.tar.gz
└── spora-frontend-v<VERSION>/     # versioned root — required by PHP's PharData
    ├── index.html
    ├── favicon.svg                # copied from public/ verbatim
    ├── assets/
    │   ├── index-<hash>.js
    │   ├── index-<hash>.css
    │   ├── logo-<hash>.svg        # bundled import from src/assets/logo.svg
    │   ├── logo-picto-<hash>.svg
    │   ├── logo-<hash>.png
    │   └── ...
```

**Nothing else ships in the archive** — no source files, no `package.json`, no `node_modules`, no build configs. The release tarball is built explicitly from `dist/` in the `build-and-release` workflow, and the `Verify only dist/ is shipped` step in the same workflow fails the build if any non-`dist/` path slips into the archive (deny-list + allow-list assertions).

The installer in `spora-ai/installer` (any 1.x release) unpacks this tarball into `public/dist/` on the operator's host, so the Vite output is served at the URL paths the SPA expects (`/index.html`, `/assets/...`, `/favicon.svg`). The installer accepts the versioned-root layout and strips the prefix when copying.

The versioned root is **load-bearing** — see "Why a versioned root directory" below.

The favicon exists at two paths in the archive:

- `spora-frontend-v<VERSION>/favicon.svg` — copied from `public/assets/favicon.svg` by a post-build mirror step in CI. Required by the verify allow-list and by legacy callers that hard-code `/favicon.svg`.
- `spora-frontend-v<VERSION>/assets/favicon.svg` — Vite's native emitted output (matches `index.html`'s `/assets/favicon.svg` reference).

Both are byte-identical. Mirror step is intentionally idempotent (`if [ -f ... ]; then cp ...; fi`) so the release still ships if the favicon source path changes — the next maintainer just updates the cp.

Note: `composer.json`'s `archive.exclude` block is **only consumed by `composer archive`** — it has no effect on the GitHub Release tarball, which is built by the CI workflow directly from `dist/`. It's there as defense-in-depth so a maintainer running `composer archive` locally doesn't accidentally ship source files in a one-off manual release.

## Why a versioned root directory

The v0.1.3 release accidentally shipped a tarball whose root entry was literally `./` (built via `cd dist; tar -czf … .` — which produces `./` paths). Composer's `TarDownloader` uses PHP's `PharData::extractTo()` internally, which fails with `Cannot extract '.', internal error` on the leading `.` directory entry. PHP requires the archive to have a non-trivial root directory.

The fix is to wrap the contents in a versioned root before tarring:

```bash
mkdir -p staging/spora-frontend-${TAG}
cp -R dist/. staging/spora-frontend-${TAG}/
tar -czf spora-frontend-${TAG}.tar.gz -C staging spora-frontend-${TAG}
```

This produces `spora-frontend-v<X.Y.Z>/…` entries, identical to what v0.1.2 (and earlier) shipped. v0.1.4 re-adopts this layout.

## Why this is the process

`composer install` reads `dist.url` from the **tagged** `composer.json`, not from the CI workspace. If you skip the prep PR and just tag the old `composer.json`, `composer install` will resolve the URL to a 404 because the new release asset doesn't exist at the old URL.

## Rollback

If a release is broken, do NOT delete + retag the same version. Git tags are immutable. Instead, tag a new patch version (e.g. `v0.1.2` → `v0.1.3`) with the fix.
