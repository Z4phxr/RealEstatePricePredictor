# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog,
and this project follows Semantic Versioning.

## [0.2.0] - 2026-03-16

### Added
- Production root Dockerfile for Railway deployment.
- Railway configuration with healthcheck and restart policy.
- CI pipeline for backend tests and frontend build.
- Repository hygiene standards (`.gitignore`, `.env.example`).
- SPA routing via `react-router-dom`.
- Release governance files (`VERSION`, `CHANGELOG`, PR template, release checklist).

### Changed
- Backend now serves built frontend static assets.
- Backend prediction endpoint now returns HTTP 503 when model is unavailable.
- CORS is configurable via `ALLOWED_ORIGINS`.
- Frontend debug logs for POI are disabled by default.

### Fixed
- Coordinate validation in map click flow now accepts valid numeric values consistently.

[0.2.0]: https://example.invalid/releases/tag/v0.2.0
