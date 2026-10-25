/** Default when git metadata is unavailable. Overwritten by `scripts/write-build-info.mjs` during wrangler deploy/dev. */
export const BUILD_SHA = "dev";
export const BUILD_AT: string | null = null;
