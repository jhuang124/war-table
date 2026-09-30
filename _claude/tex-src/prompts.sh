#!/bin/zsh
# Phase 0 source renders (docs/INK2.md §4.1). One render per map; see texmaps.json for the picks.
IG() { node $HOME/Desktop/JH-Projects/imagegen/bin/imagegen.mjs "$@"; }
D=/Users/jhuang/Desktop/JH-Projects/risk3d/_claude/tex-src
TAIL="Flat, evenly lit, no shadows, no vignette, no border, no text, no objects, fills the frame edge to edge, seamless tileable, high detail, greyscale."
TAIL_TIP="Flat, evenly lit, no shadows, no vignette, no border, no text, no objects, pure white paper around the stroke, high detail, greyscale."
gen() { # name aspect prompt [suffix]
  IG generate -p "$3" --aspect $2 --out $D/$1${4:-}.png < /dev/null > $D/$1${4:-}.log.json 2> $D/$1${4:-}.err; echo "$1${4:-} exit $?" >> $D/status.txt
}
