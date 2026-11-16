#!/usr/bin/env bash
# Rewrite SHA256SUMS.txt of a GitHub release over every asset (also assets uploaded by other
# jobs, e.g. the notarised macOS files or the Android APK). Uses the digest GitHub reports and
# falls back to downloading the asset. Usage: sha256sums.sh <tag>   (needs GH_TOKEN)
set -euo pipefail
tag="$1"
repo="${GITHUB_REPOSITORY:-robeertm/linkwache}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
gh api "repos/$repo/releases/tags/$tag" --jq '.assets[] | select(.name != "SHA256SUMS.txt") | [.name, (.digest // "")] | @tsv' > "$work/assets.tsv"
: > "$work/SHA256SUMS.txt"
while IFS=$'\t' read -r name digest; do
  if [[ "$digest" == sha256:* ]]; then
    hex="${digest#sha256:}"
  else
    gh release download "$tag" -R "$repo" -p "$name" -D "$work/dl" --clobber
    hex=$(sha256sum "$work/dl/$name" | cut -d' ' -f1)
  fi
  printf '%s  %s\n' "$hex" "$name" >> "$work/SHA256SUMS.txt"
done < "$work/assets.tsv"
sort -k2 -o "$work/SHA256SUMS.txt" "$work/SHA256SUMS.txt"
gh release upload "$tag" -R "$repo" "$work/SHA256SUMS.txt" --clobber
cat "$work/SHA256SUMS.txt"
