// Ashfall Bunker character and enemy models for vector.js. One entry per model; each part is a shape drawn in order.
// Colours: "#rrggbb", or ["color", f] / ["accent", f] = the game's body or hair colour shaded by factor f.
// Shapes: rr (rounded rect) circ ell line poly cap legs hlegs mound teeth. "half": 1 adds the darker right half. y is up-negative; 0 = feet.
const VEC_MODELS = {
  person: { label: "Crew member", kind: "crew", shadow: 9, note: "Shirt and hair colours come from each crew member in the game.", color: "#6f7d5a", accent: "#d8cfbf", looks: [{"id":"default","label":"Survivor","color":"#6f7d5a","accent":"#d8cfbf"},{"id":"bram","label":"Old Bram","color":"#8c8f96","accent":"#d9d4c8"},{"id":"juno","label":"Juno Park","color":"#3f5f8f","accent":"#f2c14e"},{"id":"reed","label":"Doc Reed","color":"#e8e4da","accent":"#6b8fb0"},{"id":"tick","label":"Tick","color":"#a86b3c","accent":"#59d0c4"}],
    parts: [
      {"id":"legs","k":"legs","lw":5,"lh":12,"gap":0.6,"c":"#2a2018","boot":"#16100a"},
      {"id":"far arm","k":"rr","x":-11,"y":-25,"w":4,"h":12,"r":2,"c":["color",0.85]},
      {"id":"torso","k":"rr","x":-8,"y":-26,"w":16,"h":15,"r":5,"c":["color",1],"half":1},
      {"id":"belt","k":"rr","x":-8,"y":-14.5,"w":16,"h":2.2,"r":0,"c":["color",0.6]},
      {"id":"near arm","k":"rr","x":7,"y":-25,"w":4,"h":12,"r":2,"c":["color",0.75]},
      {"id":"far hand","k":"circ","x":-9,"y":-12.5,"r":2,"c":"#e2c29a"},
      {"id":"near hand","k":"circ","x":9,"y":-12.5,"r":2,"c":"#c9a77e"},
      {"id":"head","k":"circ","x":0,"y":-30.5,"r":5.6,"c":"#e2c29a"},
      {"id":"hair","k":"cap","x":0,"y":-31.4,"r":6.1,"drop":1,"c":["accent",1]},
      {"id":"eye","k":"circ","x":2.6,"y":-30,"r":0.95,"c":"#222222"}
    ] },
  mara: { label: "Mara Voss", kind: "player", shadow: 10, note: "The player character.", color: "#7a5a3a", accent: "#ffb347", looks: [{"id":"default","label":"Mara","color":"#7a5a3a","accent":"#ffb347"}],
    parts: [
      {"id":"legs","k":"legs","lw":5.5,"lh":14,"gap":0.6,"c":"#2a2018","boot":"#16100a"},
      {"id":"far arm","k":"rr","x":-12,"y":-29,"w":4.4,"h":14,"r":2.2,"c":"#5a4028"},
      {"id":"jacket","k":"rr","x":-9,"y":-30,"w":18,"h":17,"r":5.5,"c":"#7a5a3a","half":1},
      {"id":"belt","k":"rr","x":-9,"y":-17,"w":18,"h":2.4,"r":0,"c":"#3a2a1a"},
      {"id":"bandolier","k":"line","x1":-6,"y1":-29,"x2":6,"y2":-16,"w":2,"c":"#3a2a1a"},
      {"id":"near arm","k":"rr","x":8,"y":-29,"w":4.4,"h":14,"r":2.2,"c":"#6a4c30"},
      {"id":"far hand","k":"circ","x":-10,"y":-15,"r":2.2,"c":"#e2c29a"},
      {"id":"near hand","k":"circ","x":10,"y":-15,"r":2.2,"c":"#c9a77e"},
      {"id":"head","k":"circ","x":0,"y":-34.4,"r":6,"c":"#e2c29a"},
      {"id":"hair","k":"cap","x":0,"y":-35,"r":6.6,"drop":3,"c":"#2b1d12"},
      {"id":"goggle strap","k":"rr","x":-6.6,"y":-38.4,"w":13.2,"h":2.6,"r":1.3,"c":"#3a2a1a"},
      {"id":"goggle lens","k":"circ","x":2,"y":-37.2,"r":2.6,"c":"#ffb347"},
      {"id":"lens glint","k":"circ","x":2,"y":-37.2,"r":1.1,"c":"#fff0cc"},
      {"id":"eye","k":"circ","x":2.8,"y":-33.4,"r":0.9,"c":"#222222"}
    ] },
  hound: { label: "Mutant hound", kind: "enemy", shadow: 14, note: "Body colour comes from the enemy definition.", color: "#9b6a4a", looks: [{"id":"default","label":"Mutant hound","color":"#9b6a4a"}],
    parts: [
      {"id":"legs","k":"hlegs","xs":[-11,-6,5,10],"signs":[1,-1,1,-1],"w":3.6,"h":7,"c":["#241810","#3a2818","#241810","#3a2818"]},
      {"id":"tail","k":"line","x1":-11,"y1":-11,"x2":-17,"y2":-17,"w":3.2,"c":["color",0.75],"fy2":-1},
      {"id":"body","k":"rr","x":-13,"y":-16,"w":26,"h":11,"r":5,"c":["color",1],"half":1},
      {"id":"head","k":"rr","x":9,"y":-19,"w":9,"h":9,"r":3.5,"c":["color",1.15]},
      {"id":"snout","k":"rr","x":15,"y":-15,"w":6,"h":4,"r":2,"c":["color",0.85]},
      {"id":"ear","k":"poly","pts":[[11,-19],[13.5,-24],[16,-19]],"c":["color",0.75]},
      {"id":"eye","k":"circ","x":14,"y":-15,"r":1.7,"c":"#ff4030"},
      {"id":"eye glint","k":"circ","x":14.4,"y":-15.4,"r":0.6,"c":"#fff0cc"},
      {"id":"fang","k":"line","x1":16,"y1":-11.5,"x2":18,"y2":-9.5,"w":1.2,"c":"#f1e6d2"},
      {"id":"spike 1","k":"line","x1":-6,"y1":-15,"x2":-7,"y2":-19,"w":1.8,"c":["color",0.75]},
      {"id":"spike 2","k":"line","x1":-1,"y1":-16,"x2":-1,"y2":-20,"w":1.8,"c":["color",0.75]},
      {"id":"spike 3","k":"line","x1":4,"y1":-16,"x2":5,"y2":-20,"w":1.8,"c":["color",0.75]}
    ] },
  ghoul: { label: "Ash ghoul", kind: "enemy", shadow: 10, note: "Body colour comes from the enemy definition.", color: "#8a8f6a", looks: [{"id":"default","label":"Ash ghoul","color":"#8a8f6a"}],
    parts: [
      {"id":"legs","k":"legs","lw":4.6,"lh":12,"gap":0.8,"c":"#3a3a30","boot":"#22221c"},
      {"id":"far arm","k":"line","x1":-8,"y1":-21,"x2":-11,"y2":-5,"w":3.6,"c":"#a9ae88","sx2":-1},
      {"id":"near arm","k":"line","x1":8,"y1":-21,"x2":11,"y2":-5,"w":3.6,"c":"#a9ae88","sx2":1},
      {"id":"far claws","k":"line","x1":-11,"y1":-5,"x2":-13,"y2":-2,"w":1.2,"c":"#a9ae88","sx1":-1,"sx2":-1},
      {"id":"near claws","k":"line","x1":11,"y1":-5,"x2":13,"y2":-2,"w":1.2,"c":"#a9ae88","sx1":1,"sx2":1},
      {"id":"torso","k":"rr","x":-8.5,"y":-23,"w":17,"h":14,"r":6,"c":["color",1],"half":1},
      {"id":"rib 1","k":"line","x1":-5,"y1":-17,"x2":5,"y2":-16,"w":1,"c":"#6a6f50"},
      {"id":"rib 2","k":"line","x1":-6,"y1":-13,"x2":6,"y2":-13,"w":1,"c":"#6a6f50"},
      {"id":"head","k":"circ","x":0,"y":-27.5,"r":6.6,"c":"#a9ae88"},
      {"id":"brow","k":"line","x1":-4.5,"y1":-31,"x2":4.5,"y2":-31,"w":1,"c":"#6a6f50"},
      {"id":"eye L","k":"circ","x":-2.6,"y":-27,"r":1.5,"c":"#1a1a10"},
      {"id":"eye R","k":"circ","x":2.6,"y":-27,"r":1.5,"c":"#1a1a10"},
      {"id":"glint L","k":"circ","x":-2.6,"y":-27,"r":0.5,"c":"#dfe6b0"},
      {"id":"glint R","k":"circ","x":2.6,"y":-27,"r":0.5,"c":"#dfe6b0"},
      {"id":"mouth","k":"line","x1":-2,"y1":-23.6,"x2":2,"y2":-23.6,"w":1.3,"c":"#3a2a22"}
    ] },
  raider: { label: "Raider", kind: "enemy", shadow: 10, note: "Body colour comes from the enemy definition. The game draws his rifle separately.", color: "#b0553a", looks: [{"id":"default","label":"Raider","color":"#b0553a"}],
    parts: [
      {"id":"legs","k":"legs","lw":5,"lh":11,"gap":0.6,"c":"#2a2018","boot":"#16100a"},
      {"id":"far arm","k":"rr","x":-11,"y":-22,"w":4,"h":11,"r":2,"c":["color",0.85]},
      {"id":"jacket","k":"rr","x":-8,"y":-23,"w":16,"h":14,"r":4.5,"c":["color",1],"half":1},
      {"id":"belt","k":"rr","x":-8,"y":-12,"w":16,"h":2.4,"r":0,"c":"#5a3020"},
      {"id":"zip","k":"line","x1":0,"y1":-23,"x2":0,"y2":-10,"w":1,"c":"#5a3020"},
      {"id":"near arm","k":"rr","x":7,"y":-22,"w":4,"h":11,"r":2,"c":["color",0.7]},
      {"id":"head","k":"circ","x":0,"y":-27,"r":5.2,"c":"#d8b89a"},
      {"id":"mask","k":"rr","x":-5.3,"y":-26,"w":10.6,"h":3.4,"r":1.5,"c":"#2a2a2a"},
      {"id":"bandana","k":"rr","x":-5.8,"y":-31.4,"w":11.6,"h":3.6,"r":1.6,"c":"#c03a2a"},
      {"id":"bandana tail","k":"poly","pts":[[-5.5,-30],[-10,-28],[-8,-26.4]],"c":"#c03a2a"},
      {"id":"eye","k":"circ","x":2.4,"y":-27.7,"r":0.9,"c":"#222222"}
    ] },
  brute: { label: "Brute", kind: "enemy", shadow: 14, note: "Body colour comes from the enemy definition.", color: "#6d5a7a", looks: [{"id":"default","label":"Brute","color":"#6d5a7a"}],
    parts: [
      {"id":"legs","k":"legs","lw":7.5,"lh":12,"gap":0.8,"c":"#2a2030","boot":"#18101e"},
      {"id":"far arm","k":"rr","x":-18,"y":-31,"w":6.4,"h":20,"r":3.2,"c":["color",1.15]},
      {"id":"near arm","k":"rr","x":11.6,"y":-31,"w":6.4,"h":20,"r":3.2,"c":["color",1]},
      {"id":"far fist","k":"circ","x":-14.8,"y":-10.5,"r":3.4,"c":["color",1.15]},
      {"id":"near fist","k":"circ","x":14.8,"y":-10.5,"r":3.4,"c":["color",1]},
      {"id":"torso","k":"rr","x":-12,"y":-32,"w":24,"h":21,"r":8,"c":["color",1],"half":1},
      {"id":"belt","k":"rr","x":-12,"y":-17,"w":24,"h":3,"r":0,"c":["color",0.7]},
      {"id":"head","k":"rr","x":-5.2,"y":-40,"w":10.4,"h":10,"r":4,"c":["color",1.3]},
      {"id":"eye L","k":"circ","x":-1.6,"y":-36,"r":1.3,"c":"#ff4030"},
      {"id":"eye R","k":"circ","x":2.6,"y":-36,"r":1.3,"c":"#ff4030"},
      {"id":"mouth","k":"line","x1":-2.4,"y1":-32.4,"x2":3,"y2":-32.4,"w":1.2,"c":["color",0.8]}
    ] },
  cinder: { label: "Cinder", kind: "boss", shadow: 11, note: "Boss. Coat colour comes from the enemy definition. The game draws his rifle separately.", color: "#e0e0d6", looks: [{"id":"default","label":"Cinder","color":"#e0e0d6"}],
    parts: [
      {"id":"legs","k":"legs","lw":5,"lh":11,"gap":0.6,"c":"#3a2a22","boot":"#1c1410"},
      {"id":"far arm","k":"rr","x":-12,"y":-26,"w":4.4,"h":15,"r":2.2,"c":["color",0.85]},
      {"id":"coat","k":"rr","x":-9.5,"y":-27,"w":19,"h":20,"r":6,"c":["color",1],"half":1},
      {"id":"scarf","k":"rr","x":-9.5,"y":-24.5,"w":19,"h":3.2,"r":0,"c":"#7a3a22"},
      {"id":"near arm","k":"rr","x":7.6,"y":-26,"w":4.4,"h":15,"r":2.2,"c":["color",0.7]},
      {"id":"hair","k":"circ","x":0,"y":-31,"r":7,"c":"#f4f4ee"},
      {"id":"face","k":"circ","x":0.6,"y":-29.4,"r":5.2,"c":"#b9a898"},
      {"id":"goggles","k":"rr","x":-4.8,"y":-32,"w":10,"h":3.2,"r":1.6,"c":"#cc2222"},
      {"id":"mouth","k":"rr","x":-2.8,"y":-26.6,"w":5.6,"h":1.5,"r":0.7,"c":"#7a3a22"}
    ] },
  maw: { label: "The Maw", kind: "boss", shadow: 24, note: "Boss. The mouth opens and closes in the game.", color: "#5b4a3a", looks: [{"id":"default","label":"The Maw","color":"#5b4a3a"}],
    parts: [
      {"id":"mound","k":"mound","hw":23,"top":-35,"c":["color",1]},
      {"id":"mouth","k":"rr","x":-17,"y":-27,"w":34,"h":22,"r":9,"c":"#3a2e24","open":1},
      {"id":"teeth","k":"teeth","x0":-15,"n":6,"step":6,"c":"#e8e0d0"},
      {"id":"eye L","k":"circ","x":-8,"y":-33,"r":2.6,"c":"#ff4030"},
      {"id":"eye R","k":"circ","x":8,"y":-33,"r":2.6,"c":"#ff4030"},
      {"id":"glint L","k":"circ","x":-8,"y":-33.4,"r":0.9,"c":"#fff0cc"},
      {"id":"glint R","k":"circ","x":8,"y":-33.4,"r":0.9,"c":"#fff0cc"},
      {"id":"left claw","k":"rr","x":-27,"y":-6,"w":8,"h":6,"r":3,"c":["color",0.85]},
      {"id":"right claw","k":"rr","x":19,"y":-7,"w":9,"h":7,"r":3,"c":["color",0.85]}
    ] },
  // ---- held items: the grip sits at x 0 and y -12 (the game moves that point onto the hand), pointing right. ----
  g_pipe: { label: "Pipe club", kind: "item", shadow: 0, note: "Held item. Melee.", color: "#8a8a90", looks: [{"id":"default","label":"Pipe club","color":"#8a8a90"}],
    parts: [
      {"id":"pipe","k":"rr","x":-6,"y":-14,"w":26,"h":4,"r":2,"c":"#8a8a90"},
      {"id":"cap","k":"rr","x":17,"y":-15,"w":4,"h":6,"r":1.5,"c":"#6a6a70"},
      {"id":"tape","k":"rr","x":-6,"y":-14.4,"w":8,"h":4.8,"r":1.5,"c":"#3a2e22"}
    ] },
  g_machete: { label: "Machete", kind: "item", shadow: 0, note: "Held item. Melee.", color: "#b8bcc0", looks: [{"id":"default","label":"Machete","color":"#b8bcc0"}],
    parts: [
      {"id":"handle","k":"rr","x":-6,"y":-13.5,"w":9,"h":3,"r":1.2,"c":"#4a3a2a"},
      {"id":"guard","k":"rr","x":2.4,"y":-15.2,"w":2,"h":6.4,"r":0.8,"c":"#2a2a2e"},
      {"id":"blade","k":"rr","x":4,"y":-14.6,"w":18,"h":4.4,"r":1.8,"c":"#b8bcc0"},
      {"id":"edge","k":"line","x1":5,"y1":-10.6,"x2":21,"y2":-10.6,"w":0.8,"c":"#e8ecf0"}
    ] },
  g_pistol: { label: "Pistol", kind: "item", shadow: 0, note: "Held item. Sidearm.", color: "#3a3a40", looks: [{"id":"default","label":"Pistol","color":"#3a3a40"}],
    parts: [
      {"id":"grip","k":"rr","x":-3,"y":-11,"w":4.5,"h":8,"r":1.6,"c":"#2a2a2e"},
      {"id":"slide","k":"rr","x":-4,"y":-16,"w":15,"h":5,"r":1.6,"c":"#3a3a40"},
      {"id":"barrel","k":"rr","x":10,"y":-15.2,"w":4,"h":2.8,"r":1,"c":"#55555c"},
      {"id":"sight","k":"rr","x":-3,"y":-17,"w":1.6,"h":1.4,"r":0.4,"c":"#55555c"}
    ] },
  g_smg: { label: "SMG", kind: "item", shadow: 0, note: "Held item. Rapid fire.", color: "#3a3a3e", looks: [{"id":"default","label":"SMG","color":"#3a3a3e"}],
    parts: [
      {"id":"stock","k":"rr","x":-12,"y":-15,"w":7,"h":3,"r":1,"c":"#5a4a3a"},
      {"id":"body","k":"rr","x":-5,"y":-16.5,"w":17,"h":5.6,"r":1.8,"c":"#3a3a3e"},
      {"id":"mag","k":"rr","x":0,"y":-11,"w":3.6,"h":9,"r":1,"c":"#2a2a2e"},
      {"id":"barrel","k":"rr","x":11,"y":-15.4,"w":7,"h":2.4,"r":1,"c":"#55555c"},
      {"id":"grip","k":"rr","x":-4,"y":-11,"w":3.6,"h":6,"r":1.4,"c":"#2a2a2e"}
    ] },
  g_shotgun: { label: "Shotgun", kind: "item", shadow: 0, note: "Held item. Short range.", color: "#4a4a50", looks: [{"id":"default","label":"Shotgun","color":"#4a4a50"}],
    parts: [
      {"id":"stock","k":"rr","x":-13,"y":-15,"w":12,"h":5,"r":1.8,"c":"#6a4a2a"},
      {"id":"receiver","k":"rr","x":-3,"y":-16.4,"w":9,"h":5,"r":1.5,"c":"#3a3a40"},
      {"id":"barrel","k":"rr","x":5,"y":-15.8,"w":22,"h":2.6,"r":1.1,"c":"#4a4a50"},
      {"id":"pump","k":"rr","x":9,"y":-13,"w":9,"h":3,"r":1.4,"c":"#6a4a2a"}
    ] },
  g_rifle: { label: "Rifle", kind: "item", shadow: 0, note: "Held item. Long range.", color: "#4a4a50", looks: [{"id":"default","label":"Rifle","color":"#4a4a50"}],
    parts: [
      {"id":"stock","k":"rr","x":-14,"y":-15.4,"w":10,"h":5,"r":1.8,"c":"#6a4a2a"},
      {"id":"receiver","k":"rr","x":-5,"y":-17,"w":11,"h":5,"r":1.5,"c":"#3a3a40"},
      {"id":"barrel","k":"rr","x":5,"y":-16,"w":25,"h":2.2,"r":1,"c":"#4a4a50"},
      {"id":"scope","k":"rr","x":-1,"y":-20,"w":9,"h":2.4,"r":1.1,"c":"#2a2a30"},
      {"id":"mag","k":"rr","x":1,"y":-12,"w":3,"h":5.5,"r":1,"c":"#2a2a2e"}
    ] },
  g_meal: { label: "Cooked meal", kind: "item", shadow: 0, note: "Held item. A plate of cooked food, carried from the kitchen to the serving station and the table.", color: "#d8cfbf", looks: [{"id":"default","label":"Cooked meal","color":"#d8cfbf"}],
    parts: [
      {"id":"plate","k":"ell","x":0,"y":-10,"rx":7,"ry":2.2,"c":"#d8cfbf"},
      {"id":"food","k":"rr","x":-4,"y":-14.6,"w":8,"h":4.6,"r":2.3,"c":"#c9843a"},
      {"id":"veg","k":"circ","x":-1.5,"y":-13.5,"r":1.6,"c":"#7ddc6f"},
      {"id":"shine","k":"circ","x":1.6,"y":-14,"r":0.9,"c":"#f2cf8a"}
    ] },
  g_crate: { label: "Raw food crate", kind: "item", shadow: 0, note: "Held item. Raw food carried from storage to the kitchen.", color: "#8a6a42", looks: [{"id":"default","label":"Raw food crate","color":"#8a6a42"}],
    parts: [
      {"id":"box","k":"rr","x":-7,"y":-16,"w":14,"h":10,"r":1.5,"c":"#8a6a42"},
      {"id":"slat","k":"line","x1":-7,"y1":-12,"x2":7,"y2":-12,"w":1,"c":"#5a4228"},
      {"id":"greens","k":"circ","x":-3,"y":-17,"r":2.4,"c":"#7ddc6f"},
      {"id":"tomato","k":"circ","x":2,"y":-17.4,"r":2.2,"c":"#d96a3a"}
    ] }
};
