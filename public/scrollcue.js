/* 'Scroll for more' cue: an in-flow row after each scrollable panel, so it never covers content or buttons. */
(function(){
  var SEL='.dbody,.help,.setp,[data-scrollcue]';
  function cueFor(el){
    var n=el.nextElementSibling;
    if(n&&n.classList.contains('scrollcue'))return n;
    if(!el.parentNode)return null;
    n=document.createElement('div');
    n.className='scrollcue';
    n.setAttribute('aria-hidden','true');
    n.innerHTML='<span>▼ Scroll for more</span>';
    el.insertAdjacentElement('afterend',n);
    return n;
  }
  function update(el){
    var c=cueFor(el);
    if(!c)return;
    var more=el.offsetParent!==null&&el.scrollHeight-el.clientHeight>4&&el.scrollTop+el.clientHeight<el.scrollHeight-4;
    c.classList.toggle('show',!!more);
  }
  function scan(){
    var els=document.querySelectorAll(SEL);
    for(var i=0;i<els.length;i++)update(els[i]);
  }
  document.addEventListener('scroll',function(e){
    var t=e.target;
    if(t&&t.matches&&t.matches(SEL))update(t);
  },true);
  window.addEventListener('resize',scan);
  setInterval(scan,300);
})();
