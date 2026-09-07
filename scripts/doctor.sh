#!/usr/bin/env bash
# scripts/doctor.sh — verify the crossbind development toolchain is ready.
#
# Checks (in order):
#   - Node              ≥ 24    (crossbind engines.node ≥ 24)
#   - pnpm              ≥ 10    (workspace packageManager pin)
#   - git               (any version)
#   - Docker            (running daemon, can pull crossbind's Emscripten image)
#   - Android SDK / NDK (when ANDROID_HOME or ANDROID_SDK_ROOT is set)
#   - Xcode             (macOS only)
#
# Exit code:
#   0  — all required tools healthy
#   1  — at least one required tool missing or below required version
#
# Usage:
#   bash scripts/doctor.sh
#   bash scripts/doctor.sh --quiet    # fewer hints, just status

set -u

QUIET=0
for arg in "$@"; do
    case "$arg" in
        --quiet|-q) QUIET=1 ;;
    esac
done

red()    { printf '\033[31m%s\033[0m' "$1"; }
green()  { printf '\033[32m%s\033[0m' "$1"; }
yellow() { printf '\033[33m%s\033[0m' "$1"; }
dim()    { printf '\033[2m%s\033[0m' "$1"; }

ok=0
warn=0
fail=0

check_ok()   { printf '  %s %s\n' "$(green '✓')" "$1"; ok=$((ok+1)); }
check_warn() { printf '  %s %s\n' "$(yellow '!')" "$1"; warn=$((warn+1)); }
check_fail() { printf '  %s %s\n' "$(red '✗')" "$1"; fail=$((fail+1)); }
hint()       { [ "$QUIET" -eq 1 ] || printf '      %s\n' "$(dim "$1")"; }

# -------- Node --------
printf '\n%s\n' "Node.js"
if command -v node >/dev/null 2>&1; then
    node_v=$(node --version | sed 's/^v//')
    node_major=${node_v%%.*}
    if [ "$node_major" -ge 24 ] 2>/dev/null; then
        check_ok "node $node_v (≥ 24)"
    else
        check_fail "node $node_v (need ≥ 24)"
        hint "Install the repository pin via nvm: 'nvm install && nvm use'"
    fi
else
    check_fail "node not found"
    hint "Install Node via nvm/fnm/volta. The root .nvmrc pins the exact supported LTS version."
fi

# -------- pnpm --------
printf '\n%s\n' "pnpm"
if command -v pnpm >/dev/null 2>&1; then
    pnpm_v=$(pnpm --version 2>/dev/null || echo "?")
    pnpm_major=${pnpm_v%%.*}
    if [ "$pnpm_major" -ge 10 ] 2>/dev/null; then
        check_ok "pnpm $pnpm_v (≥ 10)"
    else
        check_warn "pnpm $pnpm_v (workspace pin is ≥ 10.33)"
        hint "Use corepack: 'corepack use pnpm@10.33.2' (or whatever packageManager pins)"
    fi
else
    check_fail "pnpm not found"
    hint "Install: 'corepack enable && corepack use pnpm@10.33.2' (or 'npm i -g pnpm')"
fi

# -------- git --------
printf '\n%s\n' "git"
if command -v git >/dev/null 2>&1; then
    git_v=$(git --version 2>/dev/null | awk '{print $3}')
    check_ok "git $git_v"
else
    check_fail "git not found"
fi

# -------- Docker --------
printf '\n%s\n' "Docker (Emscripten/Android builds run inside Docker)"
if command -v docker >/dev/null 2>&1; then
    if docker info >/dev/null 2>&1; then
        docker_v=$(docker --version 2>/dev/null | awk '{print $3}' | tr -d ',')
        check_ok "docker $docker_v (daemon running)"
    else
        check_fail "docker installed but daemon not running"
        hint "Start Docker Desktop / 'systemctl start docker'"
    fi
else
    check_fail "docker not found"
    hint "Install Docker Desktop (macOS/Windows) or Docker Engine (Linux)"
fi

# -------- Android (only if user set ANDROID_HOME) --------
printf '\n%s\n' "Android SDK / NDK"
android_home="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -n "$android_home" ]; then
    if [ -d "$android_home" ]; then
        check_ok "ANDROID_HOME=$android_home"
        ndk_dir="$android_home/ndk"
        if [ -d "$ndk_dir" ] && [ -n "$(ls -A "$ndk_dir" 2>/dev/null)" ]; then
            ndk_versions=$(ls "$ndk_dir" | tr '\n' ' ')
            check_ok "NDK installed: $ndk_versions"
        else
            check_warn "NDK not found under $ndk_dir"
            hint "Install NDK 25+ via Android Studio → SDK Manager → SDK Tools"
        fi
    else
        check_fail "ANDROID_HOME=$android_home but directory missing"
    fi
else
    check_warn "ANDROID_HOME / ANDROID_SDK_ROOT not set (skipping Android checks)"
    hint "Required only if you build for android — see Android Studio install"
fi

# -------- Xcode (macOS only) --------
if [ "$(uname)" = "Darwin" ]; then
    printf '\n%s\n' "Xcode (iOS builds)"
    if command -v xcodebuild >/dev/null 2>&1; then
        xc_v=$(xcodebuild -version 2>/dev/null | head -1 | awk '{print $2}')
        check_ok "xcodebuild $xc_v"
        if xcrun --find clang >/dev/null 2>&1; then
            check_ok "xcrun + Command Line Tools available"
        else
            check_warn "xcrun missing Command Line Tools"
            hint "Run: 'xcode-select --install'"
        fi
    else
        check_fail "xcodebuild not found"
        hint "Install Xcode from the Mac App Store + 'xcode-select --install'"
    fi
fi

# -------- summary --------
printf '\n%s\n' "Summary"
printf '  %s OK  %s warnings  %s failures\n' \
    "$(green "$ok")" "$(yellow "$warn")" "$(red "$fail")"

if [ "$fail" -gt 0 ]; then
    printf '\n%s\n' "$(red 'doctor: at least one required tool is missing or out of date.')"
    exit 1
fi
if [ "$warn" -gt 0 ]; then
    printf '\n%s\n' "$(yellow 'doctor: warnings only — proceed but address when convenient.')"
fi
exit 0
