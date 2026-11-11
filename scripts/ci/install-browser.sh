#!/usr/bin/env bash
# Installs Chromium and its system packages for the release gate.
#
# The browser comes from Playwright's download host; its system packages come
# from Ubuntu's archive. On 2026-11-11 the runners could not resolve *.ubuntu.com
# for over half an hour, `playwright install --with-deps` failed and every deploy
# in that window failed with it, although only nine font packages were missing.
#
# So: retry the browser download; if Ubuntu's archive cannot be reached, fetch
# the packages from a second mirror; if they still cannot be installed, carry on
# only when Chromium demonstrably starts and renders a page. A missing font then
# never blocks a release, and a missing library still fails the gate.
set -uo pipefail

FALLBACK_MIRROR="${FF_APT_FALLBACK_MIRROR:-http://mirrors.edge.kernel.org/ubuntu/}"
DEPS_TIMEOUT="${FF_DEPS_TIMEOUT:-420}"

retry() {
  local attempt=1
  until "$@"; do
    if [ "$attempt" -ge 3 ]; then return 1; fi
    echo "Attempt $attempt failed: $*; retrying in $((attempt * 20))s"
    sleep $((attempt * 20))
    attempt=$((attempt + 1))
  done
}

archive_reachable() {
  local host
  for host in archive.ubuntu.com security.ubuntu.com; do
    getent hosts "$host" > /dev/null || return 1
  done
}

SWITCHED=0
use_fallback_mirror() {
  [ "$SWITCHED" = 1 ] && return 0
  SWITCHED=1
  echo "Switching apt to $FALLBACK_MIRROR"
  # Only the fallback: apt would otherwise keep waiting on the unreachable hosts
  # (about 20s per lookup in a real DNS outage) and run out of time.
  if [ -f /etc/apt/apt-mirrors.txt ]; then
    printf '%s\tpriority:1\n' "$FALLBACK_MIRROR" | sudo tee /etc/apt/apt-mirrors.txt > /dev/null
  fi
  local f
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
    [ -f "$f" ] || continue
    sudo sed -i -E "s#https?://(azure\.)?(archive|security)\.ubuntu\.com/ubuntu/?#${FALLBACK_MIRROR}#g" "$f"
  done
}

# Playwright switches to root itself. A timed-out apt can keep the package
# lock, so it is stopped before the next attempt.
install_deps() {
  timeout --kill-after=15 "$DEPS_TIMEOUT" npx playwright install-deps chromium && return 0
  sudo pkill -x apt-get 2> /dev/null || true
  sudo pkill -x dpkg 2> /dev/null || true
  sleep 3
  return 1
}

chromium_renders() {
  node - <<'JS'
const { chromium } = require('playwright')
;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setContent('<main><h1>FairFund</h1><p>Rs 1,234.56 &#8377; 12.3%</p></main>')
  const text = await page.textContent('p')
  const shot = await page.screenshot()
  await browser.close()
  if (!text.includes('1,234.56') || shot.length < 1000) throw new Error('Chromium did not render the test page')
  console.log('Chromium starts and renders pages')
})().catch((error) => { console.error(error); process.exit(1) })
JS
}

retry npx playwright install chromium || { echo "::error::Chromium download failed after 3 attempts"; exit 1; }

if ! archive_reachable; then
  echo "::warning::Ubuntu archive does not resolve on this runner; using $FALLBACK_MIRROR"
  use_fallback_mirror
fi

DEPS=0
if install_deps; then
  DEPS=1
elif [ "$SWITCHED" = 0 ]; then
  echo "::warning::Installing Chromium system packages failed; retrying through $FALLBACK_MIRROR"
  use_fallback_mirror
  install_deps && DEPS=1
fi

if chromium_renders; then
  if [ "$DEPS" = 0 ]; then
    echo "::warning::Chromium system packages could not be installed (package servers unreachable). Chromium starts and renders without them, so the release gate continues."
  fi
  exit 0
fi
echo "::error::Chromium does not start on this runner (system packages installed: $([ "$DEPS" = 1 ] && echo yes || echo no))"
exit 1
