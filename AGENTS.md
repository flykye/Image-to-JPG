# Repository Guidelines

## Project Structure & Module Organization
- `src/ui/main/`: Electron main-process code (`index.js`, `preload.js`, `conversion-worker.js`).
- `src/ui/renderer/`: Renderer UI (`index.html`, `renderer.js`, `styles.css`).
- `src/core/converters/`: Format-specific conversion logic (HEIC, LIVP, DNG, TIFF, JPG).
- `src/core/services/`: Shared services (file management, progress reporting, error handling, file-signature detection).
- `src/core/batch/`: Batch orchestration used by conversion flows; supports recursive subdirectory scanning (`scanDirectoryRecursive`).
- `src/cli/index.js`: CLI entry point (`batch-image-processor`).
- `src/assets/`: App icons and packaged static assets.
- `testdng/`: Sample input/output fixtures for manual conversion checks.
- `dist/`: Build artifacts (generated; do not edit manually).

## Build, Test, and Development Commands
- `npm start`: Launch the Electron GUI locally.
- `npm run cli -- <dir>`: Run CLI conversion against a target folder.
- `npm run cli -- <dir> -r`: Run CLI conversion recursively (each subfolder gets its own `jpg/` output).
- `npm test`: Run Jest test suite.
- `npm run test:watch`: Run tests in watch mode.
- `npm run test:coverage`: Generate coverage report.
- `npm run build:mac` / `npm run build:win` / `npm run build:linux`: Package app for each platform.

## Coding Style & Naming Conventions
- Use 2-space indentation and single quotes (`.prettierrc`).
- Keep lines near `printWidth: 100`.
- Prefer `kebab-case` filenames (for example, `file-signature.js`) and descriptive module names.
- Follow ESLint recommended rules from `.eslintrc.json`; avoid introducing unused variables.
- Keep converter logic format-specific; place cross-cutting concerns in `src/core/services/`.

## Testing Guidelines
- Framework: Jest (configured via `package.json` scripts).
- Add tests next to a future `test/` directory using `*.test.js` naming.
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
