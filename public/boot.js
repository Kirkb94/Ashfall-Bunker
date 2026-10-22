/* Boot screen: preloads sprite sheets, shows progress + tips only if loading is slow (>250ms). */
(function(){
  var files=['mara-voss','doc-tobias-reed','juno-park','old-bram','cinder','wren','the-warden-unit-9','sister-odalys-crane','tick','dr','sergeant-hale-dorrow','fenn-whitlock','vesper','maw','lamp','reverend-calloway-finch','pike','echo','rook','marguerite-mags-oyelaran','nell','wanderer-ex-soldier','wanderer-field-nurse','wanderer-old-farmhand','wanderer-scrap-picker','wanderer-tarp-poncho','wanderer-young-courier'];
  var tips=['Everyone in here is a person. Lamp suggests remembering that.','Beds set your capacity. Nobody leaves, but some will sleep on the floor.','The night is coming. It always is.','Scavenging topside is dangerous, and the bunker keeps running without you.','Hold the hatch.','Scrap fixes a cracked bunk. Hope is not accepted as payment.'];
  var total=files.length*2,done=0,loaded=document.readyState==='complete',shown=false,hidden=false,el=null,bar=null,tipEl=null,tipI=0,tipT=0;
  function build(){
    el=document.createElement('div');el.id='boot';
    el.innerHTML='<div class="boot-in"><div class="boot-title">ASHFALL BUNKER</div><div class="boot-bar" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div><div class="boot-tip" role="status" aria-live="polite"></div></div>';
    document.body.appendChild(el);
    bar=el.querySelector('.boot-bar');tipEl=el.querySelector('.boot-tip');
    tipI=Math.floor(Math.random()*tips.length);tipEl.textContent=tips[tipI];
    tipT=setInterval(function(){tipI=(tipI+1)%tips.length;tipEl.textContent=tips[tipI];},2800);
  }
  function pct(){return loaded?Math.min(100,Math.round(done/total*100)):Math.min(95,Math.round(done/total*100));}
  function paint(){if(!el)return;var p=pct();bar.firstChild.style.width=p+'%';bar.setAttribute('aria-valuenow',p);}
  function hide(){
    if(hidden)return;hidden=true;clearInterval(tipT);clearTimeout(showT);
    if(!el)return;
    el.classList.add('out');
    setTimeout(function(){if(el&&el.parentNode)el.parentNode.removeChild(el);},400);
  }
  function check(){paint();if(loaded&&done>=total)hide();}
  function tick(){done++;check();}
  var showT=setTimeout(function(){if(hidden)return;shown=true;build();paint();},250);
  setTimeout(hide,8000);
  window.addEventListener('load',function(){loaded=true;check();});
  files.forEach(function(f){
    var img=new Image();img.onload=img.onerror=tick;img.src='sprites/'+f+'.png';
    try{fetch('sprites/'+f+'.json').then(function(r){return r.text();}).then(tick,tick);}catch(e){tick();}
  });
})();
