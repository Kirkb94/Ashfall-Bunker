Ludo sprite batch for Ashfall Bunker
1. Install Node.js if you do not have it (nodejs.org).
2. In a terminal in this folder run:  npx @ludoai/cli login   (browser sign-in, needs a Ludo plan with API access)
3. See the cost first:  node make-sprites.js --only mara
4. Generate for real:   node make-sprites.js --go --only mara
   Then all of them:    node make-sprites.js --go
Results land in games/ashfall-bunker/art/ludo/<id>/ (still, idle and walk spritesheets). Tell Claude when a batch is done and it adds them to the concept board.
Edit characters.json to change any prompt. Re-running skips files that already exist.
