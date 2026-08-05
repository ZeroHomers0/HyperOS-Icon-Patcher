# Repository Guidelines

## Project Structure & Module Organization

This repository is both the source tree and the KernelSU module root. Keep `module.prop`, `customize.sh`, and `uninstall.sh` at the archive root.

- `webroot/`: KernelSU WebUI HTML, CSS, and ES modules.
- `scripts/backend.sh`: privileged device operations and validation.
- `tools/hipzip/`: Go source and tests for the Android ARM64 MRC/ZIP helper.
- `tools/pack-module/`: Go packaging utility.
- `tools/test-*.{mjs,sh}`: frontend contracts and backend boundary tests.
- `bin/hipzip-arm64`: compiled helper shipped in releases.
- `tools/pack-release.ps1` and `pack-module.bat`: Windows release packaging.
- `output/`: the required generated-release directory. All module ZIPs must be written here; never place generated ZIPs at the repository root or commit this directory.

Generated ZIPs, local toolchains, logs, and editor settings are ignored.

## Build, Test, and Development Commands

Run commands from the repository root:

```powershell
node tools/test-contract.mjs
go test ./...
bash -n customize.sh uninstall.sh scripts/*.sh tools/*.sh
bash tools/test-backend.sh
.\tools\build-hipzip.ps1
.\tools\pack-release.ps1
```

The contract test checks required DOM IDs, backend operations, and UI regressions. Go tests validate archive manipulation. Backend tests exercise shell boundary conditions with test shims. `build-hipzip.ps1` cross-compiles the ARM64 helper; only rebuild it when Go helper code changes. The release script creates a root-layout ZIP and verifies required entries. Windows users may double-click `pack-module.bat`.

Release packages must be generated under the repository-root `output/` directory. Running `tools/pack-release.ps1` or double-clicking `pack-module.bat` without an explicit output argument must produce `output/HyperOS-Icon-Patcher-vX.Y.Z.zip`. Keep `output/` ignored and never use the repository root as the generated-package destination.

## Coding Style & Naming Conventions

Use two-space indentation in JavaScript, CSS, HTML, JSON, and shell code. Keep JavaScript as small ES modules and route device calls through `backend-client.js`. Prefer descriptive camelCase names in JavaScript, snake_case backend operation names, and uppercase shell constants. Quote shell paths and validate all user-controlled values before privileged file operations. Format Go with `gofmt`; use conventional `_test.go` test files.

Versioned WebUI filenames and query strings provide cache busting (for example, `cache-101.js?v=151`). Update the query when shipped frontend behavior changes.

## Testing Guidelines

Add regression assertions to `tools/test-contract.mjs` for UI contracts and tests beside Go code for archive behavior. Extend `tools/test-backend.sh` for security, storage, rollback, or path-handling changes. Before packaging, run all applicable checks above and inspect the ZIP to confirm `module.prop` is at its root.

## Commit & Pull Request Guidelines

History uses concise conventional prefixes such as `feat:`, `fix:`, `perf:`, and `build:`. Keep each commit focused and written in the imperative mood.

Pull requests should describe user-visible behavior, failure handling, and tests run. Include mobile screenshots for layout changes and relevant sanitized logs for device-side fixes. For releases, update `module.prop`, `update.json`, and `CHANGELOG.md` together; tags use `vX.Y.Z` and assets use `HyperOS-Icon-Patcher-vX.Y.Z.zip`.
