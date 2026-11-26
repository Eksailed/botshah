const shipAtlas = new Image();
shipAtlas.src='/naval-ships.png';
const shipCrops = {
  4:[43,30,1456,300],
  3:[109,365,998,232],
  2:[106,638,659,166],
  1:[110,851,299,132]
};
function paintShip(canvas,size) {
  const [x,y,width,height]=shipCrops[size];
  canvas.width=width;canvas.height=height;
  const paint=()=>{
    const context=canvas.getContext('2d');
    context.clearRect(0,0,width,height);
    context.drawImage(shipAtlas,x,y,width,height,0,0,width,height);
  };
  if(shipAtlas.complete&&shipAtlas.naturalWidth)paint();
  else shipAtlas.addEventListener('load',paint,{once:true});
}
const sizes = [4,3,3,2,2,2,1,1,1,1];
const letters = 'АБВГДЕЖЗИК';
const coordinate = cell => letters[cell%10]+(Math.floor(cell/10)+1);
const toolNames = {shot:'Выстрел',plane:'Самолёт',torpedo:'Подлодка',scan:'Сканер'};

function shipCount(count) {
  return count+' '+(count===1?'корабль':count>=2&&count<=4?'корабля':'кораблей');
}
function attackMessage(state) {
  const last=state.lastAction;
  if(!last)return '';
  const incoming=last.side!==state.side;
  const prefix=incoming?'Соперник · ':'';
  if(last.kind==='scan') {
    const scan=incoming?null:state.scans.at(-1);
    return incoming?'Соперник использовал сканер':scan?'Сканер · '+scan.count+' целых палуб в области '+coordinate(scan.cell):'';
  }
  const hitCount=last.hitCount ?? (incoming
    ? (state.fleet??[]).flat().filter(cell=>last.targets?.includes(cell)).length
    : state.shots.filter(shot=>shot.hit&&last.targets?.includes(shot.cell)).length);
  if(last.mineTriggered)return prefix+'Мина! Усиления заблокированы на один ход';
  if(last.sunkCount)return prefix+(last.sunkCount===1?'Корабль потоплен!':last.sunkCount+' корабля потоплено!');
  if(hitCount)return prefix+'Попадание!'+(hitCount>1?' Повреждено палуб: '+hitCount:'');
  return prefix+'Мимо';
}
export function navalScreen({root,api,onMenu,onUpdate,onSound}) {
  let state, own=false, tool='shot', origin=null, direction='horizontal', edge='top';
  let fleet=[], mine=null, timer, busy=false, active=false, generation=0, message='';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function node(tag,text,className) {
    const element = document.createElement(tag);
    if (text) element.textContent=text;
    if (className) element.className=className;
    return element;
  }
  function button(text,action,className='') {
    const element=node('button',text,className);
    element.type='button';element.onclick=action;element.disabled=busy;
    return element;
  }
  function sound(kind) { try { onSound?.(kind); } catch {} }
  function schedule() {
    clearTimeout(timer);
    if (!active || state?.result || state?.handoff || state?.training==='local') return;
    timer=setTimeout(async()=>{
      if (busy || document.hidden) { schedule();return; }
      const computer=state.training && state.phase==='battle' && state.turn==='b';
      if (computer) {
        await run(()=>api('/'+state.id+'/computer',{version:state.version}));
        return;
      }
      if (state.training) return;
      const snapshot=state, currentGeneration=generation;
      try {
        const next=await api('/'+snapshot.id);
        if (active && generation===currentGeneration && state===snapshot && !busy &&
            (next.version!==snapshot.version || next.ready!==snapshot.ready)) await load(next);
      } catch(error) {
        if(active && generation===currentGeneration && state===snapshot && !busy && error.status===410) {
          stop();onMenu();return;
        }
      } finally {
        if(active && generation===currentGeneration)schedule();
      }
    },1500);
  }
  async function run(action) {
    if (busy || !active) return;
    busy=true;message='';draw();
    const currentGeneration=generation;
    try {
      const next=await action();
      if (active && generation===currentGeneration && next) await load(next);
    } catch(error) {
      if (!active || generation!==currentGeneration) return;
      message=error.message;
      if (error.status===409) {
        try { await load(await api('/'+state.id)); } catch {}
      }
    } finally {
      if (active && generation===currentGeneration) { busy=false;draw();schedule(); }
    }
  }
  function submit(data) { return run(()=>api('/'+state.id+'/move',{...data,version:state.version})); }
  function stop() { active=false;busy=false;generation++;clearTimeout(timer); }
  async function leave() {
    if (busy) return;
    if (state.training==='local' && !state.result && !state.handoff) {
      await run(()=>api('/'+state.id+'/suspend',{version:state.version}));
    }
    stop();onMenu();
  }
  function preview() {
    if (origin===null) return [];
    if (tool==='scan') {
      if (origin%10>7 || Math.floor(origin/10)>7) return [];
      return Array.from({length:9},(_,i)=>origin+Math.floor(i/3)*10+i%3);
    }
    if (tool==='plane') {
      if (direction==='horizontal' && origin%10>7 || direction==='vertical' && origin>79) return [];
      return [origin,origin+(direction==='horizontal'?1:10),origin+(direction==='horizontal'?2:20)];
    }
    if (tool==='torpedo') {
      const vertical=edge==='top'||edge==='bottom';
      const reverse=edge==='bottom'||edge==='right';
      const start=vertical?(reverse?90:0)+origin%10:Math.floor(origin/10)*10+(reverse?9:0);
      return Array.from({length:10},(_,i)=>start+i*(vertical?10:1)*(reverse?-1:1));
    }
    return [origin];
  }
  function place(cell) {
    const size=sizes[fleet.length];
    if (!size) {
      if (fleet.flat().includes(cell)) { message='Мина должна быть в пустой клетке';draw();return; }
      mine=cell;draw();return;
    }
    const ship=Array.from({length:size},(_,i)=>cell+i*(direction==='horizontal'?1:10));
    if (ship.some(n=>n>=100 || direction==='horizontal' && Math.floor(n/10)!==Math.floor(cell/10)) ||
        ship.some(n=>fleet.flat().some(old=>Math.abs(n%10-old%10)<=1 && Math.abs(Math.floor(n/10)-Math.floor(old/10))<=1))) {
      message='Корабль выходит за край или касается другого';draw();return;
    }
    fleet.push(ship);message='';draw();
  }
  async function copyInvite() {
    try { await navigator.clipboard.writeText(state.invite);message='Ссылка скопирована'; }
    catch { message=state.invite; }
    draw();
  }
  function draw() {
    if (!state || !active) return;
    root.replaceChildren();
    if (state.handoff) {
      const panel=node('div',null,'naval-handoff');
      panel.append(node('span','⚓','naval-anchor'),node('h2','Передайте телефон'),
        node('p',(state.side==='w'?'Первый':'Второй')+' игрок, откройте своё поле'),
        button(busy?'Открываем…':'Я готов',()=>run(()=>api('/'+state.id+'/handoff',{version:state.version})),'brass'));
      root.append(panel);return;
    }
    const setup=state.phase==='setup'&&!state.placed;
    const yours=state.training==='local'?(state.side==='w'?'Первый игрок':'Второй игрок'):'Вы';
    const opponent=state.training==='local'?(state.side==='w'?'Второй игрок':'Первый игрок'):state.training?'Компьютер':state.opponent||'Соперник';
    const status=state.result ? state.result==='cancelled'?'Партия отозвана':state.training==='local'?(state.result==='w'?'Первый':'Второй')+' игрок победил':state.result===state.side?'Вы победили!':'Вы проиграли'
      : setup?'Расстановка флота':state.phase==='setup'?'Ждём расстановку соперника':state.turn===state.side?'Ваш ход':'Ход соперника';
    const heading=node('div',null,'naval-heading');
    heading.append(node('strong',status),node('span',state.mode==='arsenal'?'Арсенал':'Классика'));
    root.append(heading);
    if (!setup) {
      const summary=node('div',null,'naval-fleets');
      for(const [name,sunk]of [[yours,(state.fleet??[]).filter(ship=>ship.every(cell=>state.incoming.includes(cell)))],[opponent,state.sunk]]){
        const group=node('div',null,'naval-fleet-status');
        group.append(node('span',name+' · '+shipCount(10-sunk.length)));
        const tokens=node('div',null,'naval-fleet-tokens');
        const removed=sunk.map(ship=>ship.length);
        for(const size of sizes){
          const token=node('span',null,'naval-fleet-token');
          const index=removed.indexOf(size);
          token.classList.toggle('lost',index!==-1);
          token.style.setProperty('--decks',size);
          token.setAttribute('aria-label',size+' палуб: '+(index===-1?'в строю':'потоплен'));
          if(index!==-1)removed.splice(index,1);
          tokens.append(token);
        }
        group.append(tokens);summary.append(group);
      }
      root.append(summary);
    }
    const report=attackMessage(state);
    if(report){
      const feedback=node('p',report,'naval-attack-report');
      feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');root.append(feedback);
    }
    if (message) root.append(node('p',message,'naval-message'));
    const controls=node('div',null,'naval-controls');
    if (setup) {
      controls.append(button('Авторасстановка',()=>{fleet=randomFleet();mine=Array.from({length:100},(_,i)=>i).find(cell=>!fleet.flat().includes(cell));message='';draw();}),
        button(direction==='horizontal'?'Повернуть ↕':'Повернуть ↔',()=>{direction=direction==='horizontal'?'vertical':'horizontal';draw();}),
        button('Сбросить',()=>{fleet=[];mine=null;draw();}));
      root.append(controls,node('p',fleet.length<10?'Разместите корабль · '+sizes[fleet.length]+' палуб. Готово '+fleet.length+'/10':state.mode==='arsenal'?'Коснитесь пустой клетки для мины':'Флот готов','naval-help'));
    } else {
      controls.append(button(own?'Поле противника':'Мой флот',()=>{own=!own;origin=null;draw();}));
      root.append(controls);
      if (state.mode==='arsenal' && !own && state.phase==='battle') {
        const tools=node('div',null,'naval-tools');
        for(const [kind,name] of Object.entries(toolNames)) {
          const element=button(name+(kind==='shot'?'':' · '+state.stock[kind]),()=>{tool=kind;origin=null;message='';draw();});
          element.dataset.tool=kind;element.setAttribute('aria-pressed',String(tool===kind));
          element.disabled=busy || kind!=='shot'&&(state.blocked||!state.stock[kind]);
          tools.append(element);
        }
        root.append(tools);
        if (state.blocked) root.append(node('p','Мина заблокировала усиления на один ход','naval-help'));
      }
    }
    const self=setup||own||state.phase==='setup';
    const visibleFleet=setup?fleet:state.fleet??[];
    const shots=new Map(state.shots.map(s=>[s.cell,s]));
    const water=new Set(self?(state.incomingWater??[]):(state.water??[]));
    const aim=preview();
    const board=node('div',null,'naval-board');
    board.setAttribute('aria-label',self?'Своё поле':'Поле соперника');
    const corner=node('span','');corner.style.gridArea='1 / 1';board.append(corner);
    for(const [index,letter] of [...letters].entries()) {
      const label=node('span',letter,'naval-coordinate');label.style.gridArea='1 / '+(index+2);board.append(label);
    }
    for(let row=0;row<10;row++) {
      const label=node('span',String(row+1),'naval-coordinate');label.style.gridArea=(row+2)+' / 1';board.append(label);
      for(let col=0;col<10;col++) {
        const cell=row*10+col, shot=shots.get(cell), occupied=visibleFleet.flat().includes(cell);
        const incoming=state.incoming.includes(cell);
        const hit=self?incoming&&occupied:shot?.hit;
        const sunk=!self&&state.sunk.flat().includes(cell);
        const element=button(setup&&cell===mine?'◆':'',()=>{
          if(setup)place(cell);
          else {origin=cell;message='';draw();}
        },'naval-cell');
        element.dataset.cell=cell;
        element.style.gridArea=(row+2)+' / '+(col+2);
        element.disabled=busy || !setup && (self||Boolean(state.result)||state.phase!=='battle'||state.turn!==state.side||tool==='shot'&&(shots.has(cell)||water.has(cell)));
        element.setAttribute('aria-label',coordinate(cell)+' '+(hit?'Попадание':self&&occupied?'Корабль':water.has(cell)?'Вода вокруг потопленного корабля':shot?'Промах':'Клетка'));
        element.classList.toggle('ship',self&&occupied||sunk||Boolean(state.result&&!self&&state.enemyFleet?.flat().includes(cell)));
        element.classList.toggle('hit',Boolean(hit));element.classList.toggle('sunk',sunk);
        const missed=self?incoming&&!occupied:Boolean(shot&&!shot.hit);
        if(!setup&&(hit||missed||water.has(cell))){
          const marker=node('span',null,'naval-marker '+(hit?'naval-ember':missed?'naval-miss':'naval-clear-water'));
          marker.setAttribute('aria-hidden','true');element.append(marker);
        }
        element.classList.toggle('aim',!self&&aim.includes(cell));
        const last=state.lastAction;
        const onThisField=last && (self ? last.side!==state.side : last.side===state.side);
        element.classList.toggle('last-attack',Boolean(!setup&&onThisField&&last.targets?.includes(cell)));
        board.append(element);
      }
    }
    const models=self?visibleFleet:state.result?(state.enemyFleet??[]):state.sunk;
    for(const ship of models) {
      const sorted=[...ship].sort((a,b)=>a-b);
      const vertical=ship.length>1 && sorted[1]-sorted[0]===10;
      const model=node('span',null,'naval-ship-model'+(vertical?' vertical':''));
      model.setAttribute('aria-hidden','true');model.style.setProperty('--ship-length',ship.length);
      model.style.gridColumn=(sorted[0]%10+2)+' / span '+(vertical?1:ship.length);
      model.style.gridRow=(Math.floor(sorted[0]/10)+2)+' / span '+(vertical?ship.length:1);
      const art=node('canvas',null,'naval-ship-art');art.dataset.size=ship.length;paintShip(art,ship.length);model.append(art);
      const damaged=self?state.incoming:state.shots.filter(shot=>shot.hit).map(shot=>shot.cell);
      model.classList.toggle('destroyed',ship.every(cell=>damaged.includes(cell)));
      board.append(model);
    }
    root.append(board);
    const actions=node('div',null,'naval-actions');
    if(setup) {
      const ready=button(busy?'Сохраняем…':'Флот готов',()=>submit({kind:'place',fleet,mine}),'brass');
      ready.disabled=busy||fleet.length!==10||state.mode==='arsenal'&&mine===null;actions.append(ready);
    } else if(state.phase==='battle'&&!own&&!state.result) {
      if(tool==='plane')actions.append(button(direction==='horizontal'?'Атака по горизонтали':'Атака по вертикали',()=>{direction=direction==='horizontal'?'vertical':'horizontal';draw();}));
      if(tool==='torpedo') {
        const select=node('select');select.setAttribute('aria-label','Край запуска торпеды');
        for(const [value,label]of Object.entries({top:'Сверху',bottom:'Снизу',left:'Слева',right:'Справа'})) {
          const option=node('option',label);option.value=value;option.selected=edge===value;select.append(option);
        }
        select.onchange=()=>{edge=select.value;draw();};actions.append(select);
      }
      const fire=button(busy?'Отправляем…':origin===null?'Выберите цель':toolNames[tool]+' · '+coordinate(aim[0]??origin),()=>submit({kind:tool,cell:aim[0],direction,edge}),'brass');
      fire.disabled=busy||!aim.length||state.turn!==state.side;actions.append(fire);
    }
    root.append(actions);
    if(state.scans.length&&!own)root.append(node('p',state.scans.map(scan=>coordinate(scan.cell)+' · '+scan.count+' целых палуб, ход '+scan.version).join(' / '),'naval-help'));
    if(!state.ready)root.append(button('Пригласить друга',copyInvite,'brass'));
    if(state.score)root.append(node('p','Счёт с другом · '+state.score.wins+' : '+state.score.losses,'naval-help'));
    if(state.result) {
      const result=node('div',null,'naval-result');result.setAttribute('role','status');
      result.append(node('h2',status),button('Реванш',()=>run(async()=>{const {rematch}=await api('/'+state.id+'/rematch',{});return api('/'+rematch);}), 'brass'),button('В главное меню',leave));
      root.append(result);
    } else {
      const footer=node('div',null,'naval-footer');
      footer.append(button('В главное меню',leave),button(state.phase==='setup'||state.training==='local'?'Отозвать':'Сдаться',()=>{
        if(confirm(state.phase==='setup'||state.training==='local'?'Отозвать эту партию?':'Сдаться в этой партии?'))run(async()=>{
          await api('/'+state.id+'/close',{version:state.version,intent:state.phase==='setup'||state.training==='local'?'withdraw':'resign'});stop();onMenu();return null;
        });
      }));root.append(footer);
    }
  }
  async function load(next) {
    if (!next) return;
    const previous=state;
    const changed=!previous||next.id!==previous.id||next.version!==previous.version||next.ready!==previous.ready;
    if (!active) {active=true;generation++;}
    if (next.id!==previous?.id || next.side!==previous?.side) {fleet=[];mine=null;own=false;tool='shot';}
    state=next;
    if(changed)origin=null;
    onUpdate(next);
    const last=next.lastAction;
    const animate=previous?.id===next.id&&next.version>previous.version&&last&&last.version===next.version;
    if(animate&&!next.handoff&&!document.hidden) {
      const mineHit=last.side===next.side?next.shots?.some(s=>last.targets?.includes(s.cell)&&s.hit):next.fleet?.flat().some(cell=>last.targets?.includes(cell));
      sound(last.kind==='scan'?'scan':last.kind==='plane'?'plane':last.kind==='torpedo'?'torpedo':mineHit?'hit':'splash');
    }
    draw();
    if(animate&&!reduced.matches&&!next.handoff&&last.sunkCount){
      const wasWater=new Set(own?(previous.incomingWater??[]):(previous.water??[]));
      for(const marker of root.querySelectorAll('.naval-clear-water')){
        if(wasWater.has(Number(marker.parentElement.dataset.cell)))continue;
        marker.animate([{transform:'translate(-50%,-50%) scale(.2)',opacity:0},{transform:'translate(-50%,-50%) scale(1.2)',opacity:.7,offset:.65},{transform:'translate(-50%,-50%) scale(1)',opacity:1}],{duration:380,easing:'ease-out'});
      }
    }
    if(animate&&!reduced.matches&&!next.handoff) {
      const board=root.querySelector('.naval-board');
      const effects=[];
      const incoming=last.side!==next.side;
      const showTarget=incoming?own:!own;
      if(board && showTarget && last.targets?.length){
        for(const cell of last.targets){
          const square=board.querySelector('[data-cell="'+cell+'"]');
          if(!square)continue;
          const hit=incoming?next.fleet?.flat().includes(cell):next.shots?.some(s=>s.cell===cell&&s.hit);
          const splash=node('span',hit?'✦':'◌','naval-burst');
          splash.setAttribute('aria-hidden','true');
          splash.style.left=(square.offsetLeft+square.offsetWidth/2)+'px';
          splash.style.top=(square.offsetTop+square.offsetHeight/2)+'px';
          board.append(splash);effects.push(splash);
        }
        if(['plane','torpedo'].includes(last.kind)){
          const first=board.querySelector('[data-cell="'+last.targets[0]+'"]');
          const final=board.querySelector('[data-cell="'+last.targets.at(-1)+'"]');
          const craft=node('span',last.kind==='plane'?'✈':'●','naval-craft');
          craft.setAttribute('aria-hidden','true');board.append(craft);effects.push(craft);
          const x=first.offsetLeft+first.offsetWidth/2,y=first.offsetTop+first.offsetHeight/2;
          craft.style.left=x+'px';craft.style.top=y+'px';
          craft.animate([{transform:'translate(-50%,-50%)',opacity:1},{transform:'translate(calc(-50% + '+(final.offsetLeft-first.offsetLeft)+'px),calc(-50% + '+(final.offsetTop-first.offsetTop)+'px))',opacity:0}],{duration:450,easing:'ease-out',fill:'both'});
        }
      }
      board?.classList.add('naval-effect-'+last.kind);
      const animations=[...(board?.getAnimations({subtree:true})??[])];
      await Promise.allSettled(animations.map(animation=>animation.finished));
      effects.forEach(effect=>effect.remove());
      board?.classList.remove('naval-effect-'+last.kind);
    }
    if(next.result&&previous?.id===next.id&&!previous.result) sound(next.training==='local'||next.result===next.side?'win':'loss');
    schedule();
  }
  document.addEventListener('visibilitychange',()=>{if(active&&!document.hidden)schedule();});
  return {load,stop};
}
function randomFleet() {
  for(;;) {
    const result=[];
    for(const size of sizes) {
      const options=[];
      for(let cell=0;cell<100;cell++)for(const step of [1,10]) {
        const ship=Array.from({length:size},(_,i)=>cell+i*step);
        if(ship.at(-1)>=100||step===1&&Math.floor(ship.at(-1)/10)!==Math.floor(cell/10))continue;
        if(ship.some(n=>result.flat().some(old=>Math.abs(n%10-old%10)<=1&&Math.abs(Math.floor(n/10)-Math.floor(old/10))<=1)))continue;
        options.push(ship);
      }
      if(!options.length)break;
      result.push(options[Math.floor(Math.random()*options.length)]);
    }
    if(result.length===10)return result;
  }
}
