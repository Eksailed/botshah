function play(element,frames,options,animations) {
  if (!element) return;
  const animation=element.animate(frames,{easing:'ease-out',...options});
  animations.push(animation);
}

export async function animateNavalAttack({root,before,after,own,reduced,valid,onImpact}) {
  if(reduced||document.hidden){onImpact?.();return;}
  const last=after.lastAction;
  if(!last)return;
  const incoming=last.side!==after.side;
  const board=root.querySelector('.naval-board');
  const animations=[];
  const overlays=[];
  const concealed=new Map();
  const conceal=element=>{if(element&&!concealed.has(element)){concealed.set(element,element.style.opacity);element.style.opacity='0';}};
  const reveal=()=>{for(const [element,opacity]of concealed)element.style.opacity=opacity;};
  const wait=async()=>{await Promise.allSettled(animations.splice(0).map(animation=>animation.finished));};
  const onField=incoming?own:!own;
  const square=cell=>board?.querySelector('[data-cell="'+cell+'"]');
  try {
    if(onField&&last.targets?.length&&board){
      for(const cell of last.targets)conceal(square(cell)?.querySelector('.naval-marker'));
      if(!incoming)for(const ship of last.sunkShips??[])conceal(board.querySelector('[data-ship="'+[...ship].sort((a,b)=>a-b).join('-')+'"]'));
      const oldClear=new Set(own?before.incomingWater??[]:before.water??[]);
      for(const marker of board.querySelectorAll('.naval-clear-water'))if(!oldClear.has(Number(marker.parentElement.dataset.cell)))conceal(marker);
      conceal(root.querySelector('.naval-attack-report'));
      const target=square(last.targets[0]);
      if(target){
        const trail=document.createElement('span');
        trail.className='naval-shot-trail';trail.setAttribute('aria-hidden','true');board.append(trail);overlays.push(trail);
        trail.style.left=(target.offsetLeft+target.offsetWidth/2)+'px';trail.style.top=(target.offsetTop+target.offsetHeight/2)+'px';
        play(trail,[{transform:'translate(-35px,60px) rotate(-60deg) scaleX(.2)',opacity:0},{opacity:1,offset:.3},{transform:'translate(0,0) rotate(-60deg) scaleX(1)',opacity:0}],{duration:180},animations);
        await wait();
      }
      if(!valid())return;
      reveal();
      onImpact?.();
      const damaged=incoming?after.fleet?.flat():after.shots?.filter(shot=>shot.hit).map(shot=>shot.cell);
      for(const cell of last.targets){
        const target=square(cell);if(!target)continue;
        const hit=damaged?.includes(cell);
        const marker=target.querySelector('.naval-marker');
        play(marker,[{transform:'translate(-50%,-50%) scale(.2)',opacity:0},{transform:'translate(-50%,-50%) scale(1.18)',opacity:1,offset:.5},{transform:'translate(-50%,-50%) scale(1)',opacity:1}],{duration:hit?450:350},animations);
        if(hit){
          const flash=document.createElement('span');flash.className='naval-hit-flash';flash.setAttribute('aria-hidden','true');target.append(flash);overlays.push(flash);
          play(flash,[{opacity:0,transform:'scale(.2)'},{opacity:.95,offset:.25},{opacity:0,transform:'scale(1.25)'}],{duration:240},animations);
          play(marker,[{filter:'brightness(1)'},{filter:'brightness(1.45)',offset:.45},{filter:'brightness(1)'}],{duration:200,iterations:2},animations);
        }
      }
      const previousSunk=incoming?(before.fleet??[]).filter(ship=>ship.every(cell=>before.incoming?.includes(cell))):before.sunk??[];
      const nowSunk=incoming?(after.fleet??[]).filter(ship=>ship.every(cell=>after.incoming?.includes(cell))):after.sunk??[];
      for(const ship of nowSunk){
        if(previousSunk.some(old=>old.length===ship.length&&old.every(cell=>ship.includes(cell))))continue;
        const model=board.querySelector('[data-ship="'+[...ship].sort((a,b)=>a-b).join('-')+'"]');
        play(model,[{opacity:incoming?1:0,filter:'brightness(1.5)'},{opacity:1,filter:'brightness(1)',offset:.25},{opacity:.7,filter:'grayscale(.7) brightness(.65)'}],{duration:650},animations);
        for(const [index,cell]of ship.entries()){
          play(square(cell)?.querySelector('.naval-wreck'),[{opacity:0,transform:'translate(-50%,-50%) scale(.3)'},{opacity:1,transform:'translate(-50%,-50%) scale(1.15)',offset:.5},{opacity:1,transform:'translate(-50%,-50%) scale(1)'}],{duration:240,delay:index*60},animations);
        }
      }
      const oldWater=new Set(own?before.incomingWater??[]:before.water??[]);
      for(const marker of board.querySelectorAll('.naval-clear-water')){
        const cell=Number(marker.parentElement.dataset.cell);if(oldWater.has(cell))continue;
        play(marker,[{transform:'translate(-50%,-50%) scale(.1)',opacity:0},{transform:'translate(-50%,-50%) scale(1.2)',opacity:.8,offset:.6},{transform:'translate(-50%,-50%) scale(1)',opacity:1}],{duration:300,delay:Math.min(180,Math.abs(cell%10-(last.targets[0]%10))*35)},animations);
      }
    }
    if(!onField)onImpact?.();
    if(incoming){
      for(const cell of last.targets??[]){
        const peg=root.querySelector('.naval-mini-map [data-cell="'+cell+'"]');
        play(peg,[{filter:'brightness(1)',transform:'scale(1)'},{filter:'brightness(2.7)',transform:'scale(1.5)',offset:.45},{filter:'brightness(1)',transform:'scale(1)'}],{duration:350},animations);
      }
    }
    if(before.turn!==after.turn){
      for(const status of root.querySelectorAll('.naval-fleet-status')){
        const current=status.classList.contains('naval-current-turn');
        play(status,[{backgroundColor:current?'transparent':'#5d724a44'},{backgroundColor:current?'#5d724a44':'transparent'}],{duration:180},animations);
      }
      const title=root.querySelector('.naval-heading strong');
      play(title,[{opacity:.25,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:180},animations);
    }
    await wait();
  } finally {
    reveal();
    overlays.forEach(overlay=>overlay.remove());
  }
}

export function animateNavalPlacement(model,reduced,from,rotation=0) {
  if(!model||reduced)return;
  const rect=model.getBoundingClientRect();
  const x=from?from.x+from.width/2-rect.x-rect.width/2:0;
  const y=from?from.y+from.height/2-rect.y-rect.height/2:-7;
  model.animate([{transform:'translate('+x+'px,'+y+'px) rotate('+rotation+'deg) scale(.94)',opacity:.6},{transform:'translate(0,0) rotate(0) scale(1)',opacity:1}],{duration:180,easing:'ease-out'});
}
export async function animateNavalBombs({root,after,own,reduced,valid,onBlast}) {
  for(const wave of after.lastAction?.bombExplosions??[]) {
    if(!valid())return;
    onBlast?.();
    if(reduced||document.hidden)continue;
    const victim=wave.owner==='w'?'b':'w';
    const visible=own?victim===after.side:victim!==after.side;
    const elements=visible?wave.targets.map(cell=>root.querySelector('.naval-board [data-cell="'+cell+'"]')):
      victim===after.side?wave.targets.map(cell=>root.querySelector('.naval-mini-map [data-cell="'+cell+'"]')):[];
    const animations=[];
    for(const element of elements.filter(Boolean))play(element,[{filter:'brightness(1)',boxShadow:'inset 0 0 0 transparent'},{filter:'brightness(2.5)',boxShadow:'inset 0 0 18px #ffb34d'},{filter:'brightness(1)',boxShadow:'inset 0 0 0 transparent'}],{duration:380},animations);
    await Promise.allSettled(animations.map(animation=>animation.finished));
  }
}
