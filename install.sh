#!/bin/sh
set -eu

repo=invrnt/vian
version=latest
install_dir=${HOME:?HOME is required}/.local/bin
base_url=

usage() {
  cat <<'EOF'
Usage: sh install.sh [--version TAG] [--dir DIRECTORY] [--repo OWNER/REPO]

Install a prebuilt Vian binary in ~/.local/bin by default. For a private
repository, authenticate with gh first. Use --dir /usr/local/bin with the
necessary filesystem permissions for a system-wide installation.
EOF
}

die() { printf 'vian installer: %s\n' "$*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version|--dir|--repo|--base-url)
      [ "$#" -ge 2 ] || die "$1 requires a value"
      case "$1" in
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

[ "$(uname -s)" = Linux ] || die 'prebuilt installation currently supports Linux only'
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) die "unsupported CPU architecture: $(uname -m)" ;;
esac
asset=vian-linux-$arch
if command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; then
  asset=$asset-musl
fi
command -v sha256sum >/dev/null 2>&1 || die 'sha256sum is required'

temp_dir=$(mktemp -d) || die 'could not create a temporary directory'
staged=
cleanup() {
  [ ! -f "$temp_dir/$asset" ] || rm "$temp_dir/$asset"
  [ ! -f "$temp_dir/SHA256SUMS" ] || rm "$temp_dir/SHA256SUMS"
  rmdir "$temp_dir" 2>/dev/null || true
  [ -z "$staged" ] || { [ ! -f "$staged" ] || rm "$staged"; }
}
trap cleanup EXIT HUP INT TERM

if [ -n "$base_url" ]; then
  download_url=${base_url%/}
else
  if [ "$version" = latest ]; then
    download_url=https://github.com/$repo/releases/latest/download
  else
    download_url=https://github.com/$repo/releases/download/$version
  fi
fi

if [ -z "$base_url" ] && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  if [ "$version" = latest ]; then
    gh release download -R "$repo" -p "$asset" -p SHA256SUMS -D "$temp_dir" || die 'release download failed'
  else
    gh release download "$version" -R "$repo" -p "$asset" -p SHA256SUMS -D "$temp_dir" || die 'release download failed'
  fi
else
  command -v curl >/dev/null 2>&1 || die 'curl is required (or authenticate with gh for a private repository)'
  curl --fail --location --silent --show-error --retry 3 "$download_url/$asset" --output "$temp_dir/$asset" || die 'binary download failed'
  curl --fail --location --silent --show-error --retry 3 "$download_url/SHA256SUMS" --output "$temp_dir/SHA256SUMS" || die 'checksum download failed'
fi

expected=$(awk -v name="$asset" '$2 == name { print $1 }' "$temp_dir/SHA256SUMS")
[ -n "$expected" ] || die "checksum is missing for $asset"
actual=$(sha256sum "$temp_dir/$asset")
actual=${actual%% *}
[ "$actual" = "$expected" ] || die "checksum mismatch for $asset"
chmod 755 "$temp_dir/$asset"
"$temp_dir/$asset" --help >/dev/null || die "downloaded $asset cannot run on this host"

mkdir -p "$install_dir" || die "cannot create $install_dir"
staged=$install_dir/.vian-install-$$
install -m 755 "$temp_dir/$asset" "$staged" || die "cannot install in $install_dir"
mv "$staged" "$install_dir/vian" || die "cannot replace $install_dir/vian"
staged=
printf 'Installed Vian at %s/vian\n' "$install_dir"
case ":$PATH:" in
  *":$install_dir:"*) ;;
  *) printf 'Add %s to PATH to run vian from any directory.\n' "$install_dir" ;;
esac
