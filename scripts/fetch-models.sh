#!/usr/bin/env bash
# Downloads and verifies the ONNX models and runtime (see fetch-models.ps1 for
# the documented version). Provided for git-bash/WSL; the PowerShell script is
# the one the README points at, since this is a Windows app.
#
#   ./scripts/fetch-models.sh [--hd] [--force] [--print-hashes]
#
# Requires curl, and one of sha256sum/shasum, plus unzip or bsdtar.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
MANIFEST="$SCRIPT_DIR/models.json"
RESOURCES="$ROOT/src-tauri/resources"
USER_MODELS="${APPDATA:-$HOME/.config}/art.philmerdigi.idphotostudio/models"
STAGING="${TMPDIR:-/tmp}/philmer-id-photo-models"

WANT_HD=0
FORCE=0
PRINT_HASHES=0
for arg in "$@"; do
  case "$arg" in
    --hd) WANT_HD=1 ;;
    --force) FORCE=1 ;;
    --print-hashes) PRINT_HASHES=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else echo "need sha256sum or shasum" >&2; exit 1
  fi
}

if [ "$PRINT_HASHES" = 1 ]; then
  echo "==> SHA-256 of files currently on disk"
  for dir in "$RESOURCES" "$USER_MODELS"; do
    [ -d "$dir" ] || continue
    for f in "$dir"/*; do
      [ -f "$f" ] || continue
      printf '%s  %12s  %s\n' "$(sha256 "$f")" "$(wc -c < "$f" | tr -d ' ')" "$(basename "$f")"
    done
  done
  exit 0
fi

# node is already a build dependency, so use it rather than requiring jq.
read_manifest() {
  node -e '
    const m = require(process.argv[1]);
    const group = process.argv[2];
    for (const i of m[group]) {
      console.log([i.file, i.url, i.sha256, i.bytes, i.archiveMember ?? "", i.label].join("\t"));
    }
  ' "$MANIFEST" "$1"
}

verify() { # path sha bytes
  [ -f "$1" ] || return 1
  local size; size="$(wc -c < "$1" | tr -d ' ')"
  [ "$3" = "0" ] || [ "$size" = "$3" ] || { echo "    size mismatch: expected $3, found $size"; return 1; }
  local actual; actual="$(sha256 "$1")"
  [ "$actual" = "$2" ] || { echo "    checksum mismatch: expected $2, got $actual"; return 1; }
  return 0
}

extract_member() { # archive member destination
  mkdir -p "$(dirname "$3")"
  if command -v unzip >/dev/null 2>&1; then
    unzip -p "$1" "$2" > "$3"
  elif command -v bsdtar >/dev/null 2>&1; then
    bsdtar -xOf "$1" "$2" > "$3"
  else
    echo "need unzip or bsdtar to extract $2" >&2; exit 1
  fi
}

fetch_group() { # group target_dir
  local group="$1" target="$2"
  mkdir -p "$target" "$STAGING"
  while IFS=$'\t' read -r file url sha bytes member label; do
    local dest="$target/$file"
    if [ "$FORCE" = 0 ] && verify "$dest" "$sha" "$bytes" >/dev/null 2>&1; then
      echo "    $file already present and verified"
      continue
    fi
    echo "==> $label"
    if [ -n "$member" ]; then
      local archive="$STAGING/$(basename "${url%%\?*}")"
      if [ ! -f "$archive" ]; then
        echo "    downloading $url"
        curl --fail --location --retry 3 --retry-delay 2 --continue-at - --progress-bar -o "$archive" "$url"
      else
        echo "    using cached $(basename "$archive")"
      fi
      extract_member "$archive" "$member" "$dest"
    else
      echo "    downloading $url"
      curl --fail --location --retry 3 --retry-delay 2 --continue-at - --progress-bar -o "$dest.part" "$url"
      mv -f "$dest.part" "$dest"
    fi
    if ! verify "$dest" "$sha" "$bytes"; then
      rm -f "$dest"
      echo "$file failed verification and was removed. Re-run the script." >&2
      exit 1
    fi
    echo "    $file verified"
  done < <(read_manifest "$group")
}

echo "==> Fetching into $RESOURCES"
fetch_group bundled "$RESOURCES"

if [ "$WANT_HD" = 1 ]; then
  echo
  echo "==> Fetching the optional HD model into $USER_MODELS"
  echo "    This is 973 MB. The app works without it."
  fetch_group optional "$USER_MODELS"
else
  echo
  echo "    Skipping the optional HD model. Pass --hd to fetch it."
fi

rm -rf "$STAGING"
echo
echo "    All models present and verified."
