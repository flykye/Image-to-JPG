# Repository Guidelines

## Project Structure & Module Organization
- `main.go`, `desktop.go`, `engine.go`, `settings.go`: MyGO window, native APIs, conversion process bridge, and settings.
- `src/desktop/worker.js`: Node conversion process and progress protocol.
- `src/ui/renderer/`: Renderer UI (`index.html`, `renderer.js`, `styles.css`).
- `src/core/converters/`: Format-specific conversion logic (HEIC, LIVP, DNG, TIFF, JPG).
- `src/core/services/`: Shared services (file management, progress reporting, error handling, file-signature detection).
- `src/core/batch/`: Batch orchestration used by conversion flows; supports recursive subdirectory scanning (`scanDirectoryRecursive`).
- `src/core/workers/`: Shared reusable conversion threads, cancellation, and estimated memory admission. GUI and CLI default to 4 threads; the GUI also offers 10 and 20.
- `src/cli/index.js`: CLI entry point with JSON/JSONL machine protocol; shared jobs are in `src/core/batch/conversion-job.js`.
- `cmd/batch-image-processor/`, `internal/cliapp/`: Standalone headless Go launcher, bundled runtime lookup and cancellation.
- `docs/cli.md`: Public CLI integration contract; preserve schema and exit-code compatibility.
- `src/assets/`: App icons and packaged static assets.
- `__tests__/fixtures/`: Small reproducible conversion and worker fixtures. `testimage/` is local user sample data; do not delete it as build output.
- `scripts/`, `runtime/`: Cross-platform runtime preparation and locked conversion dependencies.
- `resources/<os>-<arch>/`, `dist/`: Generated runtime, frontend, and packaged apps; do not edit manually.

## Build, Test, and Development Commands
- `npm run clean -- --dry-run` / `npm run clean`: Preview/remove obsolete build products and temporary reports; retain current packages, source fixtures, dependencies, and runtime download cache.
- `npm start`: Prepare the bundled conversion runtime and launch the MyGO GUI locally (Go 1.27.3+, Bun, and Node.js required).
- `npm run cli -- <dir>`: Run CLI conversion against a target folder.
- `npm run cli -- <dir> -r`: Run CLI conversion recursively (each subfolder gets its own `jpg/` output).
- `npm test`: Run Jest test suite.
- `npm run test:watch`: Run tests in watch mode.
- `npm run test:coverage`: Generate coverage report.
- `npm run build:all`: On macOS, package Apple Silicon, Intel Mac, and Windows x64 desktop apps plus standalone CLIs into `dist/`.
- `npm run build:mac` / `npm run build:win` / `npm run build:linux`: Package app and platform-specific Node/sharp runtime.
- `npm run build:cli:mac` / `npm run build:cli:win`: Package standalone CLI ZIPs with bundled Node and conversion dependencies.
- `node scripts/verify-cli.mjs <os>/<arch>`: Extract and execute the native CLI ZIP, including conversion and cancellation checks.
- `go test ./...` / `go vet ./...`: Check Go desktop services.
- `npm run build:web`: Build the Vite frontend.

## Coding Style & Naming Conventions
- JavaScript uses 2-space indentation and single quotes (`.prettierrc`); Go uses `gofmt`.
- Keep lines near `printWidth: 100`.
- Prefer `kebab-case` filenames (for example, `file-signature.js`) and descriptive module names.
- Follow ESLint recommended rules from `.eslintrc.json`; avoid introducing unused variables.
- Keep converter logic format-specific; place cross-cutting concerns in `src/core/services/`.

## Testing Guidelines
- Framework: Jest (configured via `package.json` scripts).
- Add core and worker tests in `__tests__/` using `*.test.js`; Go tests use `*_test.go`.
- Minimum expectation for PRs: tests for new converter/service behavior and key error paths.
- Before opening PR: run `npm test` and `npm run test:coverage`.

## Commit & Pull Request Guidelines
- Commit history shows mixed styles; prefer Conventional Commits (`feat:`, `fix:`, `refactor:`) moving forward.
- Keep subject lines imperative and specific (for example, `fix: preserve EXIF on HEIC conversion`).
- PRs should include: purpose, scope, test evidence (command output), and UI screenshots/GIFs for renderer changes.
- Link related issues and call out platform-specific impacts (macOS/Windows/Linux) when relevant.

## Security & Configuration Tips
- Do not commit real user photos or sensitive metadata.
- Keep large sample files out of Git unless required for reproducible fixtures.
- Validate filesystem paths and errors through existing service-layer helpers before adding new IO logic.
