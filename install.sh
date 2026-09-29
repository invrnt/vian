#!/bin/sh
set -eu

repo=invrnt/vian
version=latest
install_dir=${HOME:?HOME is required}/.local/bin
base_url=
runtime=auto

usage() {
  cat <<'EOF'
Usage: sh install.sh [--runtime auto|standalone|bun] [--version TAG] [--dir DIRECTORY] [--repo OWNER/REPO]

Install the newest published Vian release with a Linux asset for this machine
in ~/.local/bin, including previews. By default, install Bun when needed,
then install Vian source and packages with bun install --frozen-lockfile.
Use --runtime standalone only to opt into a self-contained binary.
EOF
}

die() { printf 'vian installer: %s\n' "$*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --runtime|--version|--dir|--repo|--base-url)
      [ "$#" -ge 2 ] || die "$1 requires a value"
      case "$1" in
        --runtime) runtime=$2 ;;
        --version) version=$2 ;;
        --dir) install_dir=$2 ;;
        --repo) repo=$2 ;;
        --base-url) base_url=$2 ;;
      esac
      shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

case "$repo" in
  */*) case "$repo" in *[!A-Za-z0-9_./-]*|/*|*/|*..*) die 'invalid repository' ;; esac ;;
  *) die 'repository must be OWNER/REPO' ;;
esac
case "$version" in ''|*[!A-Za-z0-9._-]*) die 'invalid version' ;; esac
[ -n "$install_dir" ] || die 'install directory is empty'
case "$runtime" in auto|standalone|bun) ;; *) die 'runtime must be auto, standalone or bun' ;; esac

[ "$(uname -s)" = Linux ] || die 'prebuilt installation currently supports Linux only'
if [ "$runtime" = auto ]; then runtime=bun; fi
if [ "$runtime" = bun ]; then
  asset=vian-source.tar.gz
  bun_path=
  if command -v bun >/dev/null 2>&1; then
    bun_path=$(command -v bun)
  elif [ -x "${BUN_INSTALL:-${HOME:?HOME is required}/.bun}/bin/bun" ]; then
    bun_path=${BUN_INSTALL:-$HOME/.bun}/bin/bun
  fi
  if [ -n "$bun_path" ] && [ "$("$bun_path" --version)" != 1.4.2 ]; then
    bun_path=${BUN_INSTALL:-$HOME/.bun}/bin/bun
    if [ ! -x "$bun_path" ] || [ "$("$bun_path" --version)" != 1.4.2 ]; then bun_path=; fi
  fi
  if [ -z "$bun_path" ]; then
    command -v curl >/dev/null 2>&1 || die 'curl is required to install Bun'
    command -v bash >/dev/null 2>&1 || die 'bash is required to install Bun'
    printf 'Installing Bun 1.4.2 with the official installer...\n'
    curl -fsSL https://bun.com/install | bash -s -- bun-v1.4.2 || die 'Bun installation failed'
    bun_path=${BUN_INSTALL:-$HOME/.bun}/bin/bun
  fi
  [ -x "$bun_path" ] || die 'Bun executable was not found'
  bun_path=$(realpath "$bun_path")
else
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) die "unsupported CPU architecture: $(uname -m)" ;;
  esac
  asset=vian-linux-$arch
  if command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; then
    asset=$asset-musl
  fi
fi
command -v sha256sum >/dev/null 2>&1 || die 'sha256sum is required'

temp_dir=$(mktemp -d) || die 'could not create a temporary directory'
staged=
cleanup() {
  rm -rf "$temp_dir"
  [ -z "$staged" ] || rm -rf "$staged"
}
trap cleanup EXIT HUP INT TERM

if [ -n "$base_url" ]; then
  download_url=${base_url%/}
else
  if [ "$version" = latest ]; then
    command -v curl >/dev/null 2>&1 || die 'curl is required to find the latest release'
    command -v python3 >/dev/null 2>&1 || die 'python3 is required to find the latest release; pass --version TAG to pin one'
    curl --fail --location --silent --show-error --retry 3 "https://api.github.com/repos/$repo/releases?per_page=100" --output "$temp_dir/releases.json" || die 'could not list published releases'
    version=$(python3 - "$temp_dir/releases.json" "$asset" <<'PY'
import json
import sys

with open(sys.argv[1], encoding='utf-8') as source:
    releases = json.load(source)
asset = sys.argv[2]
usable = []
if isinstance(releases, list):
    for release in releases:
        if not isinstance(release, dict) or release.get('draft') or not release.get('published_at'):
            continue
        assets = {item.get('name') for item in release.get('assets', []) if isinstance(item, dict) and item.get('state') == 'uploaded'}
        if asset in assets and 'SHA256SUMS' in assets and isinstance(release.get('tag_name'), str):
            usable.append(release)
usable.sort(key=lambda release: release['published_at'], reverse=True)
if usable:
    print(usable[0]['tag_name'])
PY
    )
    [ -n "$version" ] || die "no published release has assets for $asset and SHA256SUMS"
    case "$version" in ''|*[!A-Za-z0-9._-]*) die 'latest release has an invalid tag' ;; esac
  fi
  download_url=https://github.com/$repo/releases/download/$version
fi

if [ "$runtime" = bun ] && [ -f "$install_dir/.vian-app/current/.vian-version" ] && [ -x "$install_dir/vian" ]; then
  installed_version=$(cat "$install_dir/.vian-app/current/.vian-version")
  if [ "$installed_version" = "$version" ] && "$install_dir/vian" --help >/dev/null 2>&1; then
    printf 'Vian %s is already installed at %s/vian\n' "$version" "$install_dir"
    exit 0
  fi
fi

if [ -z "$base_url" ] && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  if [ "$version" = latest ]; then
    gh release download -R "$repo" -p "$asset" -p SHA256SUMS -D "$temp_dir" || die 'release download failed'
  else
    gh release download "$version" -R "$repo" -p "$asset" -p SHA256SUMS -D "$temp_dir" || die 'release download failed'
  fi
else
  command -v curl >/dev/null 2>&1 || die 'curl or authenticated gh is required'
  curl --fail --location --silent --show-error --retry 3 "$download_url/$asset" --output "$temp_dir/$asset" || die 'release download failed'
  curl --fail --location --silent --show-error --retry 3 "$download_url/SHA256SUMS" --output "$temp_dir/SHA256SUMS" || die 'checksum download failed'
fi

expected=$(awk -v name="$asset" '$2 == name { print $1 }' "$temp_dir/SHA256SUMS")
[ -n "$expected" ] || die "checksum is missing for $asset"
actual=$(sha256sum "$temp_dir/$asset")
actual=${actual%% *}
[ "$actual" = "$expected" ] || die "checksum mismatch for $asset"
mkdir -p "$install_dir" || die "cannot create $install_dir"
install_dir=$(cd "$install_dir" && pwd -P)
if [ "$runtime" = bun ]; then
  app_root=$install_dir/.vian-app
  mkdir -p "$app_root/releases" || die 'cannot create Vian application directory'
  staged=$app_root/releases/.stage-$$
  mkdir "$staged" || die 'cannot stage Vian source'
  tar -tzf "$temp_dir/$asset" | awk '/^\// || /(^|\/)\.\.($|\/)/ { unsafe=1 } END { exit unsafe }' || die 'source archive has unsafe paths'
  tar -xzf "$temp_dir/$asset" -C "$staged" || die 'source extraction failed'
  [ -f "$staged/package.json" ] && [ -f "$staged/bun.lock" ] && [ -f "$staged/install.sh" ] && [ -f "$staged/packages/cli/src/main.ts" ] || die 'source archive is incomplete'
  (cd "$staged" && "$bun_path" install --frozen-lockfile --production) || die 'Bun dependency installation failed'
  "$bun_path" "$staged/packages/cli/src/main.ts" --help >/dev/null || die 'installed source failed its --help check'
  printf '%s\n' "$version" > "$staged/.vian-version"
  release_dir=$app_root/releases/$version-$$
  mv "$staged" "$release_dir" || die 'cannot activate Vian source'
  staged=
  printf '%s\n' "$bun_path" > "$app_root/.bun-path-$$"
  mv "$app_root/.bun-path-$$" "$app_root/bun-path"
  ln -s "releases/$(basename "$release_dir")" "$app_root/.current-$$"
  mv -Tf "$app_root/.current-$$" "$app_root/current" || die 'cannot switch Vian release'
  staged=$install_dir/.vian-install-$$
  cat > "$staged" <<'WRAPPER'
#!/bin/sh
set -eu
vian_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
bun_path=$(cat "$vian_dir/.vian-app/bun-path")
exec "$bun_path" "$vian_dir/.vian-app/current/packages/cli/src/main.ts" "$@"
WRAPPER
  chmod 755 "$staged"
  mv "$staged" "$install_dir/vian" || die "cannot replace $install_dir/vian"
  staged=
else
  chmod 755 "$temp_dir/$asset"
  "$temp_dir/$asset" --help >/dev/null || die "downloaded $asset cannot run on this host"
  staged=$install_dir/.vian-install-$$
  install -m 755 "$temp_dir/$asset" "$staged" || die "cannot install in $install_dir"
  mv "$staged" "$install_dir/vian" || die "cannot replace $install_dir/vian"
  staged=
fi
printf 'Installed Vian at %s/vian\n' "$install_dir"
case ":$PATH:" in
  *":$install_dir:"*) ;;
  *) printf 'Add %s to PATH to run vian from any directory.\n' "$install_dir" ;;
esac
