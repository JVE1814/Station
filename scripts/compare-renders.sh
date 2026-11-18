#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

views=(cab chase map)
conditions=(day night snow)
mkdir -p evidence/comparisons
for row in "${!views[@]}"; do
  for column in "${!conditions[@]}"; do
    view="${views[row]}"
    condition="${conditions[column]}"
    render="evidence/$view-$condition.png"
    extent="$(magick identify -format '%wx%h' "$render")"
    if [[ "$extent" != 1920x1080 ]]; then
      printf 'Expected a 1920×1080 render at %s, got %s\n' "$render" "$extent" >&2
      exit 1
    fi
    crop="557x313+$((column * 557))+$((row * 313))"
    magick \( reference/view-study.png -crop "$crop" +repage -resize 1920x1080! \) \
      "$render" +append -quality 90 \
      "evidence/comparisons/$view-$condition.jpg"
  done
done
