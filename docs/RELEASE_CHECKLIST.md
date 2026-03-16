# Release Checklist

## Before Release

1. Ensure default branch is protected (see `scripts/apply-branch-protection.ps1`).
2. Confirm CI is green on the release branch.
3. Update `VERSION` and `CHANGELOG.md`.
4. Verify local production checks:
   - backend tests: `pytest backend/tests -q`
   - frontend build: `npm run build` in `frontend`
   - docker image build: `docker build -t price-railway .`
   - health check: `/api/health`
5. Verify required env vars in deployment platform:
   - `ALLOWED_ORIGINS`
   - `MODEL_PATH` (optional override)
   - `PORT` (platform-managed)

## Release

1. Run GitHub Actions workflow `Release` with target version (example: `0.2.1`).
2. Confirm tag `v<version>` and GitHub Release are created.
3. Deploy tagged revision to Railway.

## After Release

1. Smoke-test production endpoints:
   - `/api/health`
   - `/api/predict`
   - `/`
2. Check Railway logs for startup/runtime warnings.
3. Announce release notes from `CHANGELOG.md`.
