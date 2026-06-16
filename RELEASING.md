# Releasing

The single, canonical process for shipping a new version. Two independent
targets that must be kept in step:

- **The git repo** (this checklist, steps 1–9) — source of truth, tagged history,
  GitHub Releases.
- **The Figma Community plugin** (step 10) — a **manual upload that does not track
  this repo**. Publishing to Community is a separate action; a green git release
  does *not* ship the plugin until step 10 is done.

Versioning is [SemVer](https://semver.org/) (`MAJOR.MINOR.PATCH`): patch =
fix/no behaviour change, minor = new option/output field, major = breaking output
schema change. Figma Community keeps its **own** release counter — it will not
match our `vX.Y.Z`; we bridge the two via the release note + the `LISTING.md`
code-version line (steps 3, 10).

**One version per Community publish — not per commit.** Bumping `vX.Y.Z` happens
*only* inside the publish checklist below, which you run only when you actually
ship to Community. It is not part of normal feature work. The version number is
meant to name a build real users received; if it moves without a publish, it stops
meaning anything (and `__VERSION__` in Dev Mode would advertise a build nobody has).

### Between publishes (the everyday path — no version bump)

Commit features and fixes straight to `main` (or via short branches) **without
touching `package.json`**. Record each change under the `## [Unreleased]` heading
in `CHANGELOG.md` (`Added` / `Changed` / `Fixed`). The version stays put; the
Unreleased section accumulates everything since the last publish. Most days never
leave this path.

## Publish checklist

Run this **only when you decide to publish to Community.** It turns the
accumulated `Unreleased` notes into one new version. Let `X.Y.Z` be that version
(pick patch/minor/major from the *combined* Unreleased changes). Work on `main`,
or a short release branch you ff-merge.

1. **Bump the version** in `package.json` (`"version": "X.Y.Z"`). This is the
   single source the build injects as `__VERSION__` (Dev Mode prints
   `Design to Code JSON (vX.Y.Z)`), so nothing else hard-codes it.

2. **Update `CHANGELOG.md`** (Keep a Changelog format):
   - Rename the accumulated `## [Unreleased]` section to `## [X.Y.Z] — YYYY-MM-DD`
     (its `Added` / `Changed` / `Fixed` notes are already there from everyday
     work), and add a fresh empty `## [Unreleased]` heading above it.
   - Update the link refs at the bottom: point `[Unreleased]` at
     `compare/vX.Y.Z...HEAD` and add `[X.Y.Z]: …/releases/tag/vX.Y.Z`.

3. **Update `LISTING.md`** (Community copy):
   - Bump the `Code version X.Y.Z` line in the Description footer.
   - Replace the `## Release notes (this version — code vX.Y.Z)` block with a
     one-paragraph summary of this release (this is what you paste into Figma in
     step 9, and it's how Figma's counter maps back to our version).

4. **Validate**: `npm run check` (runs both unit suites + rebuilds
   `dist/code.js`). Must be green before committing — `dist/` is the plugin entry
   point and is gitignored, so the build is also how you confirm `__VERSION__`
   baked in.

5. **Commit** all of the above together. End the message with the
   `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

6. **Integrate into `main`**: `git checkout main && git merge --ff-only <branch>`
   (history here is linear; a non-ff merge means something diverged — stop and
   look).

7. **Tag**: `git tag -a vX.Y.Z -m "vX.Y.Z"` on the release commit. One annotated
   tag per `CHANGELOG` entry; the tag commit should be the version-bump commit.

8. **Push**: `git push origin main --follow-tags` (pushes the branch and the new
   tag together).

9. **Create the GitHub Release** from the tag. A pushed tag is **not** a Release —
   the Releases page only lists releases you explicitly create, so this step is
   what makes the version show up there. Use this version's `CHANGELOG.md` section
   as the body so the release matches the tagged history:

   ```bash
   gh release create vX.Y.Z --title "vX.Y.Z" --notes "$(
     awk '/^## \[X.Y.Z\]/{f=1;next} f&&/^## \[/{exit} f' CHANGELOG.md
   )"
   ```

   The `awk` prints the lines between the `## [X.Y.Z]` header and the next entry.
   `gh` marks the newest release **Latest** automatically; pass `--latest=false`
   when backfilling an older version after newer ones already exist.

10. **Publish to Figma Community** (manual, desktop app):
   - Figma desktop → **Plugins → Development → Import plugin from manifest…** →
     `manifest.json` (loads the freshly built `dist/code.js`).
   - Right-click the plugin → **Publish new version**.
   - Paste the **Release notes** from `LISTING.md`; confirm the Description
     footer shows the new code version.
   - Publish. If behaviour looks stale in the wild afterwards, suspect a missed
     re-publish here — the repo and Community do not sync automatically.

## One-time / occasional

- **Backfilling a missed tag**: map version → commit via
  `git log -S'"version": "X.Y.Z"' -- package.json` (the commit that introduced
  that version string), then `git tag -a vX.Y.Z <commit> -m "vX.Y.Z"`. Don't
  overwrite a tag that already exists on the remote — it's likely the truer
  release point. Then create its GitHub Release with the step-9 `gh release
  create` command (add `--latest=false` for anything but the newest version).
