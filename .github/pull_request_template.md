## Summary

<!-- What this PR changes and why. -->

## Verify

Run locally (Node 22):

```bash
npm ci
bash scripts/check-secrets.sh
npm run typecheck
npm test
```

- [ ] `bash scripts/check-secrets.sh`
- [ ] `npm run typecheck`
- [ ] `npm test`

## Safety

- [ ] No secrets committed
- [ ] No pricing or payment changes (or maintainer approval obtained)
