# Contributing

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

## Local setup

Use Node.js 22 (see `.nvmrc`). `package.json` `engines.node` is `>=20`.

```bash
npm ci
```

## Checks

Run the same checks CI runs before opening a pull request:

```bash
bash scripts/check-secrets.sh
npm run typecheck
npm test
```

These map to `package.json` scripts as follows:

- `secret-scan` runs `bash scripts/check-secrets.sh`
- `typecheck` runs `tsc --noEmit -p tsconfig.json && tsc --noEmit -p scripts/tsconfig.json && tsc --noEmit -p tsconfig.node.json`
- `test` runs `vitest run --project unit`

`test:worker` (`vitest run --project worker`) is a separate script. Do not substitute it for `npm test`.

## Branch and pull request flow

1. Create a branch from the latest `main`.
2. Keep the change focused on one item.
3. Run the checks above.
4. Open a pull request against `main`.

## Pricing and payment changes

Changes that affect pricing or payment require maintainer approval.
