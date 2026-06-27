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
   - Creates the GitHub Release with the asset attached
5. Packagist auto-indexes the new tag within ~5 minutes.

## Why this is the process

`composer install` reads `dist.url` from the **tagged** `composer.json`, not from the CI workspace. If you skip the prep PR and just tag the old `composer.json`, `composer install` will resolve the URL to a 404 because the new release asset doesn't exist at the old URL.

## Rollback

If a release is broken, do NOT delete + retag the same version. Git tags are immutable. Instead, tag a new patch version (e.g. `v0.1.2` → `v0.1.3`) with the fix.

## History

- v0.1.0 — initial release (dist.url hardcoded to `{$version}` — broken)
- v0.1.1 — first attempt at `%version%` fix (still broken — `%version%` substitutes the normalized version, not the git tag)
- v0.1.2 — first working release (via the prep-PR process above)
