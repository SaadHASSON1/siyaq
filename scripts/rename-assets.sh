#!/usr/bin/env bash
# Finishes a release once every system's build is uploaded:
#  - gives the installers names anyone can understand (Siyaq-Mac.dmg, ...);
#  - writes latest.json for the updater from the signature files, in one go. (Letting each build job update it
#    raced: jobs finishing together overwrote each other's entries.)
# Usage: scripts/rename-assets.sh v0.5.8   (needs gh with write access, and node)
set -euo pipefail
TAG="$1"; V="${TAG#v}"; REPO="${GITHUB_REPOSITORY:-SaadHASSON1/siyaq}"
BASE="https://github.com/$REPO/releases/download/$TAG"
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
gh release download "$TAG" --repo "$REPO" --pattern '*.sig' --dir "$tmp"
node - "$tmp" "$V" "$BASE" <<'JS'
const [dir, version, base] = process.argv.slice(2);
const fs = require('fs'), sig = f => fs.existsSync(`${dir}/${f}`) ? fs.readFileSync(`${dir}/${f}`, 'utf8').trim() : null;
const platforms = {};
const add = (keys, file, url) => { const s = sig(file); if (s) for (const k of keys) platforms[k] = { signature: s, url: `${base}/${url}` }; };
add(['darwin-aarch64', 'darwin-x86_64', 'darwin-aarch64-app', 'darwin-x86_64-app'], 'Siyaq_universal.app.tar.gz.sig', 'Siyaq_universal.app.tar.gz');
add(['windows-x86_64', 'windows-x86_64-nsis'], `Siyaq_${version}_x64-setup.exe.sig`, 'Siyaq-Windows-Setup.exe');
add(['linux-x86_64', 'linux-x86_64-appimage'], `Siyaq_${version}_amd64.AppImage.sig`, 'Siyaq-Linux.AppImage');
if (Object.keys(platforms).length < 8) { console.error('missing signatures:', Object.keys(platforms)); process.exit(1); }
fs.writeFileSync(`${dir}/latest.json`, JSON.stringify({ version, notes: '', pub_date: new Date().toISOString(), platforms }, null, 2));
JS
gh release upload "$TAG" "$tmp/latest.json" --repo "$REPO" --clobber
echo "latest.json written for all systems"
