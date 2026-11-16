#!/bin/sh
# Build FakeBrowser.app for the macOS end-to-end test: build.sh <output dir>
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out="$1/FakeBrowser.app"
rm -rf "$out"
mkdir -p "$out/Contents/MacOS"
cp "$here/Info.plist" "$out/Contents/Info.plist"
swiftc -O -o "$out/Contents/MacOS/FakeBrowser" "$here/main.swift" -framework Cocoa
codesign --force -s - "$out"
echo "$out"
