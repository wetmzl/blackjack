# Agent Notes

## Cloudflare Pages CI/CD

This repository's production static site is deployed with Cloudflare Pages Direct Upload.

- Pages project: `blackjack`
- Production branch: `main`
- Build command: `npm run build`
- Build output: `dist/`
- Production URL: `https://blackjack-9bp.pages.dev`
- Wrangler version used for the first release: `4.128.0`

### Credentials

Local Cloudflare credentials are stored in the git-ignored `.env.local` file. Never print, copy into source files, or commit their values.

The Pages deployment requires:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

R2/S3 variables in `.env.local` are unrelated to a normal static Pages deployment. Do not add them to hosted CI unless a future build or deployment step actually uses R2.

In hosted CI, configure `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the CI provider's encrypted secret store rather than creating `.env.local`.

### Local production deployment

Run from the repository root:

```bash
set -a
source ./.env.local
set +a
npm run build
npx --yes wrangler@4.128.0 pages deploy dist --project-name blackjack --branch main
```

The `blackjack` Pages project already exists. Do not run `pages project create` during routine deployments.

The existing `npm run deploy` command restarts the local systemd service; it does not deploy to Cloudflare Pages.

### CI deployment steps

For a clean CI runner with the two Cloudflare secrets injected as environment variables:

```bash
npm ci
npm run build
npx --yes wrangler@4.128.0 pages deploy dist --project-name blackjack --branch main
```

Deploy `main` only after the build succeeds. Feature branches may omit `--branch main` or pass their actual branch name to create preview deployments.

### Verification

After production deployment, verify the stable URL:

```bash
curl --fail --silent --show-error --location --output /dev/null \
  --write-out '%{http_code}\n' https://blackjack-9bp.pages.dev/
```

Expected status: `200`.
