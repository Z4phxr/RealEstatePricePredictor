## Summary

Describe what changed and why.

## Type Of Change

- [ ] Bug fix
- [ ] Feature
- [ ] Refactor
- [ ] Documentation
- [ ] CI/CD

## Validation

- [ ] Backend tests pass (`pytest backend/tests -q`)
- [ ] Frontend production build passes (`npm run build` in `frontend`)
- [ ] Health endpoint verified (`/api/health`)
- [ ] Changelog updated (`CHANGELOG.md`)
- [ ] Version updated (`VERSION`) when release-impacting

## Deployment Risk

- [ ] No runtime env var changes
- [ ] Env var changes documented in `README.md`
- [ ] Database/data migration required

## Checklist

- [ ] No secrets in diff
- [ ] No build/cache artifacts committed
- [ ] Backward compatibility considered
