#!/usr/bin/env bash
# Gives a release's installers names anyone can understand (Siyaq-Mac.dmg, ...) and
# points latest.json at them, since Windows and Linux updates download the installer itself.
# Usage: scripts/rename-assets.sh v0.5.3   (needs gh, signed in with write access)
set -euo pipefail
TAG="$1"; V="${TAG#v}"; REPO="${GITHUB_REPOSITORY:-SaadHASSON1/siyaq}"
# old:new pairs (plain list, so it also runs on the Mac's bash 3)
PAIRS="Siyaq_${V}_universal.dmg:Siyaq-Mac.dmg Siyaq_${V}_x64-setup.exe:Siyaq-Windows-Setup.exe Siyaq_${V}_amd64.AppImage:Siyaq-Linux.AppImage"
new_name() { for p in $PAIRS; do [[ "${p%%:*}" == "$1" ]] && echo "${p##*:}"; done; return 0; }
# The releases list includes drafts, which the by-tag lookup does not.
ASSETS=$(gh api "repos/$REPO/releases" --paginate --jq ".[] | select(.tag_name == \"$TAG\") | .assets[] | \"\(.id) \(.name)\"")
while read -r id name; do
  new=$(new_name "$name")
  if [[ -n "$new" ]]; then
    gh api -X PATCH "repos/$REPO/releases/assets/$id" -f name="$new" >/dev/null
    echo "$name -> $new"
  fi
done <<< "$ASSETS"

tmp=$(mktemp -d)
gh release download "$TAG" --repo "$REPO" --pattern latest.json --dir "$tmp"
for p in $PAIRS; do sed -i.bak "s|/${p%%:*}\"|/${p##*:}\"|g" "$tmp/latest.json"; done
gh release upload "$TAG" "$tmp/latest.json" --repo "$REPO" --clobber
echo "latest.json updated"
