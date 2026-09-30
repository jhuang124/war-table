#!/bin/zsh
source /Users/jhuang/Desktop/JH-Projects/risk3d/_claude/tex-src/prompts.sh
gen paper 1:1 "Macro texture of handmade washi paper: long fine fibres running mostly left-to-right (about 6:1 anisotropy), a few crossing fibres, soft mottling, a scattering of tiny flecks. Very subtle, low contrast. $TAIL" &
gen wash 1:1 "Macro of a watercolour wash drying on cold-press paper: pigment pooled unevenly, cauliflower back-run blooms with pale centres and a darker tide line round each, granulation settling into the paper tooth. Mid grey overall. $TAIL" &
gen streaks 16:9 "A single very long straight horizontal dry-brush stroke of black ink on white paper, viewed close: bristle streaks with gaps where hairs lifted, the stroke thickening and thinning slowly along its length, some hairs breaking off and rejoining. $TAIL" &
wait
gen tip 1:1 "The very end of a single dry brush stroke of black ink on white paper where the brush lifted off: the stroke thins and splits into a few separate bristle hairs that fade out, each ending on its own. Stroke enters from the left, ends toward the right. $TAIL_TIP" &
gen smoke 1:1 "Black ink dropped into still water, photographed against white: soft rising wisps and curls, thinning at the top, fine tendrils. $TAIL" &
wait
echo done >> /Users/jhuang/Desktop/JH-Projects/risk3d/_claude/tex-src/status.txt
