/**
 * site-config.mjs — Single source of truth for the deployed site URL.
 *
 * Shared by gen-unfurls.mjs and gen-sitemap.mjs so a domain change is ONE edit.
 *
 * When you move to a custom domain (e.g. https://fairfund.in served at root):
 *   1. Set SITE below to the new origin, no trailing slash, no subpath
 *      (e.g. 'https://fairfund.in', dropping the '/fairfund' suffix).
 *   2. Change vite.config.ts `base` from './' to '/' (custom domains serve
 *      from root), and update the Sitemap URL in public/robots.txt.
 *   3. Rebuild. All shells, OG URLs, canonicals and the sitemap regenerate.
 */

// Origin + optional subpath, no trailing slash.
export const SITE = 'https://nishants-lab.github.io/fairfund'

// Path depth from the deploy root to a shell at f/<code>/ or s/<page>/.
// On GitHub Pages project sites the shells sit at /fairfund/f/<code>/, so the
// redirect climbs back to /fairfund/. On a root custom domain it's /f/<code>/,
// still two levels, so '../../' holds either way. Kept explicit for clarity.
export const SHELL_UP = '../../'

// Default social cover image (per-fund images override this when present).
export const COVER_IMAGE = `${SITE}/og-cover.png`
