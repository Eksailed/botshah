import {animateNavalAttack,animateNavalPlacement,animateNavalBombs} from './naval-animation.js';
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
  if(last.bombExplosions?.length)return 'Бомба! Ответный взрыв · ловушек сработало: '+last.bombExplosions.length;
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
function battleLogLines(action, name) {
  const waves = action.bombExplosions ?? [];
  const reflectedSinks = new Set(waves.filter(wave => wave.owner === action.side)
    .flatMap(wave => wave.sunkShips.map(ship => ship.join('-'))));
  const directSinks = (action.sunkShips ?? []).filter(ship => !reflectedSinks.has(ship.join('-')));
  const trap = waves.some(wave => wave.owner !== action.side && wave.cell === action.targets[0]);
  const outcome = directSinks.length ? 'корабль потоплен'
    : action.hitCount ? 'попадание' : trap ? 'выстрел в ловушку' : 'мимо';
  return [
    name(action.side)+' · '+coordinate(action.targets[0])+' · '+outcome,
    ...waves.map(wave => {
      const victim = wave.owner === 'w' ? 'b' : 'w';
      const damage = wave.hitCount ? 'повреждено палуб: '+wave.hitCount : 'без новых повреждений';
      const sunk = wave.sunkShips.length ? ' · потоплено кораблей: '+wave.sunkShips.length : '';
      return 'Ловушка '+coordinate(wave.cell)+' · взрыв на поле «'+name(victim)+'» · '+damage+sunk;
    })
  ];
}
export function navalScreen({root,api,onMenu,onUpdate,onSound}) {
  let state, own=false, tool='shot', origin=null, direction='horizontal', edge='top';
  let bombs=[], placementTool='ships';
  let fleet=[], mine=null, timer, busy=false, active=false, generation=0, message='';
  let reconnecting=false, pendingVersion, networkMessage='';
  let animating=false, selectedShip, logOpen=false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function node(tag,text,className) {
    const element = document.createElement(tag);
    if (text) element.textContent=text;
    if (className) element.className=className;
    return element;
  }
  function button(text,action,className='') {
    const element=node('button',text,className);
    element.type='button';element.onclick=action;element.disabled=busy||animating||reconnecting;
    return element;
  }
  function sound(kind) { try { onSound?.(kind); } catch {} }
  function schedule() {
    clearTimeout(timer);
    if (!active || (!reconnecting && (state?.result || state?.handoff || state?.training==='local'))) return;
    timer=setTimeout(async()=>{
      if (busy || animating || document.hidden) { schedule();return; }
      const computer=!reconnecting && state.training && state.phase==='battle' && state.turn==='b';
      if (computer) {
        await run(()=>api('/'+state.id+'/computer',{version:state.version}),true);
        return;
      }
      if (state.training && !reconnecting) return;
      const snapshot=state, currentGeneration=generation;
      try {
        const next=await api('/'+snapshot.id);
        if (!active || generation!==currentGeneration || state!==snapshot || busy || animating) return;
        const recovered = reconnecting;
        if (recovered) {
          reconnecting = false;
          networkMessage = pendingVersion !== undefined && next.version === pendingVersion
            ? 'Сервер не подтвердил действие. Проверьте поле и повторите.'
            : 'Связь восстановлена. Поле проверено.';
          pendingVersion = undefined;
        }
        if (next.version!==snapshot.version || next.ready!==snapshot.ready || next.handoff!==snapshot.handoff) await load(next);
        else if (recovered) draw();
      } catch(error) {
        if (!active || generation!==currentGeneration || state!==snapshot || busy) return;
        if (error.status===410) {
          stop();onMenu();return;
        }
        if (error.network && !reconnecting) {
          reconnecting = true;
          networkMessage = 'Связь потеряна. Проверяем поле…';
          draw();
        }
      } finally {
        if(active && generation===currentGeneration)schedule();
      }
    },reconnecting?2500:1500);
  }
  async function run(action, sending=false) {
    if (busy || animating || reconnecting || !active) return;
    busy=true;message='';networkMessage=sending?'Отправляем ход…':'';draw();
    const version=state.version;
    const currentGeneration=generation;
    try {
      const next=await action();
      if (active && generation===currentGeneration && next) { networkMessage='';await load(next); }
    } catch(error) {
      if (!active || generation!==currentGeneration) return;
      if (error.network) {
        reconnecting=true;
        pendingVersion=version;
        networkMessage='Связь потеряна. Проверяем поле…';
        return;
      }
      networkMessage='';
      message=error.message;
      if (error.status===409) {
        try { await load(await api('/'+state.id)); } catch {}
      }
    } finally {
      if (active && generation===currentGeneration) { busy=false;draw();schedule(); }
    }
  }
  function submit(data) { return run(()=>api('/'+state.id+'/move',{...data,version:state.version}),true); }
  function stop() { active=false;busy=false;animating=false;reconnecting=false;pendingVersion=undefined;networkMessage='';generation++;clearTimeout(timer); }
  async function leave() {
    if (busy||animating) return;
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
  function fits(ship,index) {
    return ship.every(cell=>cell>=0&&cell<100&&!bombs.includes(cell))&&!ship.some(cell=>fleet.some((other,i)=>i!==index&&other.some(old=>Math.abs(cell%10-old%10)<=1&&Math.abs(Math.floor(cell/10)-Math.floor(old/10))<=1)));
  }
  function invalidPlacement(ship) {
    message='Корабль выходит за край, касается другого или перекрывает бомбу';draw();
    for(const cell of ship){const element=root.querySelector('[data-cell="'+cell+'"]');if(element)element.classList.add('naval-invalid');}
    if(!reduced.matches)root.querySelector('.naval-board')?.animate([{transform:'translateX(0)'},{transform:'translateX(-3px)'},{transform:'translateX(3px)'},{transform:'translateX(0)'}],{duration:180});
  }
  function place(cell) {
    if(placementTool==='bombs') {
      if(bombs.includes(cell)){bombs=bombs.filter(value=>value!==cell);message='';}
      else if(fleet.flat().includes(cell))message='На корабль бомбу ставить нельзя';
      else if(bombs.length===3)message='Можно поставить не больше 3 бомб';
      else {bombs.push(cell);message='';}
      draw();return;
    }
    const existing=fleet.findIndex(ship=>ship.includes(cell));
    if(existing!==-1){selectedShip=existing;direction=fleet[existing].length>1&&fleet[existing][1]-fleet[existing][0]===10?'vertical':'horizontal';message='Корабль выбран. Коснитесь новой клетки или нажмите «Повернуть»';draw();return;}
    const index=selectedShip??fleet.length,size=sizes[index];
    if(!size)return;
    const ship=Array.from({length:size},(_,i)=>cell+i*(direction==='horizontal'?1:10));
    if(!fits(ship,index)||direction==='horizontal'&&Math.floor(ship.at(-1)/10)!==Math.floor(cell/10)){invalidPlacement(ship);return;}
    const old=root.querySelector('[data-ship-index="'+index+'"]')?.getBoundingClientRect();
    fleet[index]=ship;selectedShip=undefined;message='';draw();
    animateNavalPlacement(root.querySelector('[data-ship-index="'+index+'"]'),reduced.matches,old);
  }
  function enablePlacementDrag(board) {
    let drag;
    let suppressClick = false;
    const highlight = (cells, invalid = false, ship = false) => {
      const inside = cells.filter(cell => cell >= 0);
      for (const square of board.querySelectorAll('.naval-cell')) {
        const cell = Number(square.dataset.cell);
        const footprint = inside.includes(cell);
        const halo = ship && inside.some(deck =>
          Math.abs(cell % 10 - deck % 10) <= 1 &&
          Math.abs(Math.floor(cell / 10) - Math.floor(deck / 10)) <= 1
        );
        square.classList.toggle('naval-drag-target', footprint && !invalid);
        square.classList.toggle('naval-drag-invalid', invalid && (footprint || halo));
      }
    };
    const canMoveBomb = (target, source) => target >= 0 &&
      !fleet.some(ship => ship.includes(target)) &&
      (target === source || !bombs.includes(target));
    const destination = event => {
      const square = document.elementFromPoint(event.clientX,event.clientY)?.closest('.naval-cell');
      if (!board.contains(square)) return null;
      const target = Number(square.dataset.cell);
      const dx = target % 10 - drag.cell % 10;
      const dy = Math.floor(target / 10) - Math.floor(drag.cell / 10);
      return drag.cells.map(cell => {
        const x = cell % 10 + dx, y = Math.floor(cell / 10) + dy;
        return x < 0 || x > 9 || y < 0 || y > 9 ? -1 : y * 10 + x;
      });
    };
    board.addEventListener('pointerdown', event => {
      suppressClick = false;
      if (drag || busy || animating || !event.isPrimary || event.button !== 0) return;
      const square = event.target.closest('.naval-cell');
      if (!square) return;
      const cell = Number(square.dataset.cell);
      const index = fleet.findIndex(ship => ship.includes(cell));
      if (index < 0 && !bombs.includes(cell)) return;
      drag = {pointer:event.pointerId, square, cell, index, cells:fleet[index] ?? [cell],
        x:event.clientX, y:event.clientY, moved:false};
      square.setPointerCapture(event.pointerId);
    });
    board.addEventListener('pointermove', event => {
      if (event.pointerId !== drag?.pointer) return;
      if (!drag.moved && Math.hypot(event.clientX-drag.x,event.clientY-drag.y) < 6) return;
      drag.moved = true;
      const cells = destination(event);
      if (!cells) {
        highlight([]);
        return;
      }
      const ship = drag.index >= 0;
      const valid = ship ? fits(cells,drag.index) : canMoveBomb(cells[0],drag.cell);
      highlight(cells,!valid,ship);
    });
    board.addEventListener('click', event => {
      if (!suppressClick) return;
      event.stopImmediatePropagation();
    }, true);
    const finish = (event, cancelled) => {
      if (event.pointerId !== drag?.pointer) return;
      const current = drag;
      const cells = !cancelled && current.moved ? destination(event) : null;
      drag = null;
      suppressClick = current.moved;
      highlight([]);
      if (!cells) return;
      if (current.index < 0) {
        const target = cells[0];
        if (target === current.cell) return;
        if (!canMoveBomb(target,current.cell)) {
          message = 'Перетащите бомбу в свободную клетку';
        } else {
          bombs = bombs.map(cell => cell === current.cell ? target : cell);
          message = '';
        }
      } else {
        if (cells.every((cell,i) => cell === current.cells[i])) return;
        if (!fits(cells,current.index)) {
          invalidPlacement(cells);
          return;
        }
        fleet[current.index] = cells;
        selectedShip = undefined;
        message = '';
      }
      draw();
    };
    board.addEventListener('pointerup', event => finish(event,false));
    board.addEventListener('pointercancel', event => finish(event,true));
    board.addEventListener('lostpointercapture', event => finish(event,true));
    board.addEventListener('contextmenu', event => {
      if (event.target.closest('.naval-draggable')) event.preventDefault();
    });
  }
  function rotateShip() {
    const nextDirection=direction==='horizontal'?'vertical':'horizontal';
    if(selectedShip===undefined){direction=nextDirection;draw();return;}
    const ship=fleet[selectedShip],size=ship.length;
    const centerX=ship.reduce((sum,cell)=>sum+cell%10,0)/size;
    const centerY=ship.reduce((sum,cell)=>sum+Math.floor(cell/10),0)/size;
    const x=Math.round(centerX-(nextDirection==='horizontal'?(size-1)/2:0));
    const y=Math.round(centerY-(nextDirection==='vertical'?(size-1)/2:0));
    const rotated=Array.from({length:size},(_,i)=>(y+(nextDirection==='vertical'?i:0))*10+x+(nextDirection==='horizontal'?i:0));
    if(x<0||y<0||x+(nextDirection==='horizontal'?size:1)>10||y+(nextDirection==='vertical'?size:1)>10||!fits(rotated,selectedShip)){invalidPlacement(rotated);return;}
    const old=root.querySelector('[data-ship-index="'+selectedShip+'"]')?.getBoundingClientRect();
    const angle=direction==='horizontal'?-90:90;
    fleet[selectedShip]=rotated;direction=nextDirection;message='';draw();
    animateNavalPlacement(root.querySelector('[data-ship-index="'+selectedShip+'"]'),reduced.matches,old,angle);
  }
  async function copyInvite() {
    try { await navigator.clipboard.writeText(state.invite);message='Ссылка скопирована'; }
    catch { message=state.invite; }
    draw();
  }
  function draw() {
    if (!state || !active) return;
    root.replaceChildren();
    if(networkMessage){
      const status=node('p',networkMessage,'naval-attack-report');
      status.setAttribute('role','status');
      root.append(status);
    }
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
    root.append(node('p','Попадание даёт дополнительный выстрел','naval-help'));
    if (!setup) {
      const summary=node('div',null,'naval-fleets');
      for(const [index,[name,sunk]]of [[yours,(state.fleet??[]).filter(ship=>ship.every(cell=>state.incoming.includes(cell)))],[opponent,state.sunk]].entries()){
        const group=node('div',null,'naval-fleet-status');
        group.classList.toggle('naval-current-turn',state.phase==='battle'&&!state.result&&state.turn===(index===0?state.side:state.side==='w'?'b':'w'));
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
      if(state.phase!=='setup'&&!own){
        const overview=node('div',null,'naval-overview');
        const toggle=button('Свой флот · открыть',()=>{own=true;origin=null;draw();});
        const map=node('span',null,'naval-mini-map');map.setAttribute('aria-hidden','true');
        for(let cell=0;cell<100;cell++){
          const peg=node('i');
          peg.dataset.cell=cell;
          peg.classList.toggle('deck',(state.fleet??[]).flat().includes(cell));
          peg.classList.toggle('damaged',state.incoming.includes(cell)&&(state.fleet??[]).flat().includes(cell));
          peg.classList.toggle('miss',state.incoming.includes(cell)&&!(state.fleet??[]).flat().includes(cell));
          map.append(peg);
        }
        toggle.prepend(map);overview.append(toggle);root.append(overview);
      }
    }
    const report=attackMessage(state);
    if(report){
      const feedback=node('p',report,'naval-attack-report');
      feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');root.append(feedback);
    }
    if (!setup && state.phase !== 'setup') {
      const journal = node('details',null,'naval-journal');
      journal.open = logOpen;
      const toggle = node('summary','Журнал боя');
      toggle.onclick = event => {
        event.preventDefault();
        logOpen = journal.open = !journal.open;
      };
      const events = node('ol',null,'naval-journal-events');
      const name = side => side === state.side ? yours : opponent;
      for (const action of [...(state.battleLog ?? [])].reverse()) {
        const [shot,...explosions] = battleLogLines(action,name);
        const row = node('li',shot);
        for (const line of explosions) row.append(node('span',line,'naval-journal-blast'));
        events.append(row);
      }
      journal.append(toggle,events.childElementCount ? events : node('p','Выстрелов пока не было','naval-help'));
      root.append(journal);
    }
    if (message) root.append(node('p',message,'naval-message'));
    const controls=node('div',null,'naval-controls');
    if (setup) {
      if(state.bombsEnabled){
        const modes=node('div',null,'naval-controls');
        for(const [value,label] of [['ships','Корабли'],['bombs','Бомбы · '+bombs.length+'/3']]){
          const choice=button(label,()=>{placementTool=value;selectedShip=undefined;message='';draw();});
          choice.setAttribute('aria-pressed',String(placementTool===value));modes.append(choice);
        }
        modes.append(button('Расставить 3 бомбы',()=>{
          const empty=Array.from({length:100},(_,cell)=>cell).filter(cell=>!fleet.flat().includes(cell));
          bombs=[];for(let i=0;i<3;i++)bombs.push(empty.splice(Math.floor(Math.random()*empty.length),1)[0]);
          placementTool='bombs';message='';draw();
        }));root.append(modes);
      }
      controls.append(button('Авторасстановка',()=>{selectedShip=undefined;fleet=randomFleet(bombs);mine=Array.from({length:100},(_,i)=>i).find(cell=>!fleet.flat().includes(cell));message='';draw();for(const model of root.querySelectorAll('.naval-ship-model'))animateNavalPlacement(model,reduced.matches);}),
        button(direction==='horizontal'?'Повернуть ↕':'Повернуть ↔',rotateShip),
        button('Сбросить',()=>{fleet=[];bombs=[];mine=null;selectedShip=undefined;draw();}));
      root.append(controls,node('p',placementTool==='bombs'?'Коснитесь пустой клетки. Повторное нажатие убирает бомбу. Можно играть без бомб.':fleet.length<10?'Разместите корабль · '+sizes[fleet.length]+' палуб. Готово '+fleet.length+'/10':state.mode==='arsenal'?'Коснитесь пустой клетки для мины':'Флот готов','naval-help'));
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
        const sunk=self?visibleFleet.some(ship=>ship.includes(cell)&&ship.every(deck=>state.incoming.includes(deck))):state.sunk.flat().includes(cell);
        const element=button(setup&&state.mode==='arsenal'&&cell===mine?'◆':'',()=>{
          if(setup)place(cell);
          else {origin=cell;message='';draw();}
        },'naval-cell');
        if(self&&(setup?bombs:state.bombs??[]).includes(cell)){
          const bomb=node('span',null,'naval-bomb');bomb.setAttribute('aria-hidden','true');element.append(bomb);
          element.setAttribute('title','Ваша бомба');
        }
        element.dataset.cell=cell;
        element.classList.toggle('naval-draggable',setup&&(occupied||bombs.includes(cell)));
        element.style.gridArea=(row+2)+' / '+(col+2);
        element.disabled=busy||animating||reconnecting || !setup && (self||Boolean(state.result)||state.phase!=='battle'||state.turn!==state.side||tool==='shot'&&(shots.has(cell)||water.has(cell)));
        element.setAttribute('aria-label',coordinate(cell)+' '+(hit?'Попадание':self&&occupied?'Корабль':water.has(cell)?'Вода вокруг потопленного корабля':shot?'Промах':'Клетка'));
        element.classList.toggle('ship',self&&occupied||sunk||Boolean(state.result&&!self&&state.enemyFleet?.flat().includes(cell)));
        element.classList.toggle('hit',Boolean(hit));element.classList.toggle('sunk',sunk);
        const missed=self?incoming&&!occupied:Boolean(shot&&!shot.hit);
        if(!setup&&(hit||missed||water.has(cell))){
          const marker=node('span',null,'naval-marker '+(hit?(sunk?'naval-wreck':'naval-fire'):missed?'naval-miss':'naval-clear-water'));
          marker.setAttribute('aria-hidden','true');element.append(marker);
        }
        element.classList.toggle('aim',!self&&aim.includes(cell));
        if(!self&&aim.includes(cell)){const target=node('span',null,'naval-reticle');target.setAttribute('aria-hidden','true');element.append(target);}
        const last=state.lastAction;
        const onThisField=last && (self ? last.side!==state.side : last.side===state.side);
        element.classList.toggle('last-attack',Boolean(!setup&&onThisField&&last.targets?.includes(cell)));
        board.append(element);
      }
    }
    const models=self?visibleFleet:state.result?(state.enemyFleet??[]):state.sunk;
    for(const [shipIndex,ship] of models.entries()) {
      const sorted=[...ship].sort((a,b)=>a-b);
      const vertical=ship.length>1 && sorted[1]-sorted[0]===10;
      const model=node('span',null,'naval-ship-model'+(vertical?' vertical':''));
      model.dataset.shipIndex=shipIndex;model.dataset.ship=sorted.join('-');
      model.classList.toggle('selected-ship',setup&&selectedShip===shipIndex);
      model.setAttribute('aria-hidden','true');model.style.setProperty('--ship-length',ship.length);
      model.style.gridColumn=(sorted[0]%10+2)+' / span '+(vertical?1:ship.length);
      model.style.gridRow=(Math.floor(sorted[0]/10)+2)+' / span '+(vertical?ship.length:1);
      const art=node('canvas',null,'naval-ship-art');art.dataset.size=ship.length;paintShip(art,ship.length);model.append(art);
      const damaged=self?state.incoming:state.shots.filter(shot=>shot.hit).map(shot=>shot.cell);
      model.classList.toggle('destroyed',ship.every(cell=>damaged.includes(cell)));
      board.append(model);
    }
    if(setup)enablePlacementDrag(board);
    root.append(board);
    const actions=node('div',null,'naval-actions');
    if(setup) {
      const ready=button(busy?'Сохраняем…':'Флот готов',()=>submit({kind:'place',fleet,mine,bombs}),'brass');
      ready.disabled=busy||animating||reconnecting||fleet.length!==10||state.mode==='arsenal'&&mine===null;actions.append(ready);
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
      fire.disabled=busy||animating||reconnecting||!aim.length||state.turn!==state.side;actions.append(fire);
    }
    root.append(actions);
    if(state.scans.length&&!own)root.append(node('p',state.scans.map(scan=>coordinate(scan.cell)+' · '+scan.count+' целых палуб, ход '+scan.version).join(' / '),'naval-help'));
    if(!state.ready)root.append(button('Пригласить друга',copyInvite,'brass'));
    if(state.score)root.append(node('p','Счёт с другом · '+state.score.wins+' : '+state.score.losses,'naval-help'));
    if(state.result) {
      const result=node('div',null,'naval-result');result.hidden=animating;result.setAttribute('role','status');
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
    if(previous?.id===next.id&&next.handoff&&next.lastAction?.kind==='shot'&&next.lastAction.version===next.version&&next.lastAction.side===previous.side){
      const currentGeneration=generation;
      const presentation=structuredClone(previous);
      presentation.battleLog=[...(previous.battleLog??[]),next.lastAction].slice(-20);
      presentation.lastAction=next.lastAction;presentation.version=next.version;presentation.turn=next.turn;
      for(const cell of next.lastAction.targets){
        if(!presentation.shots.some(shot=>shot.cell===cell))presentation.shots.push({cell,hit:Boolean(next.lastAction.hitCount)});
      }
      for(const ship of next.lastAction.sunkShips??[])presentation.sunk.push(ship);
      for(const wave of next.lastAction.bombExplosions??[]){
        if(wave.side===previous.side){
          for(const cell of wave.hitCells){const shot=presentation.shots.find(item=>item.cell===cell);if(shot)shot.hit=true;else presentation.shots.push({cell,hit:true});}
          for(const ship of wave.sunkShips)if(!presentation.sunk.some(old=>old.join()===ship.join()))presentation.sunk.push(ship);
        }else for(const cell of wave.hitCells)if(!presentation.incoming.includes(cell))presentation.incoming.push(cell);
        if(wave.owner===previous.side)presentation.bombs=(presentation.bombs??[]).filter(cell=>cell!==wave.cell);
      }
      const sunkCells=presentation.sunk.flat();
      presentation.water=Array.from({length:100},(_,cell)=>cell).filter(cell=>!sunkCells.includes(cell)&&sunkCells.some(deck=>Math.abs(cell%10-deck%10)<=1&&Math.abs(Math.floor(cell/10)-Math.floor(deck/10))<=1));
      state=presentation;animating=true;origin=null;draw();
      try {
        await animateNavalAttack({root,before:previous,after:presentation,own,reduced:reduced.matches,valid:()=>active&&generation===currentGeneration,onImpact:()=>sound(next.lastAction.hitCount?'hit':'splash')});
        await animateNavalBombs({root,after:presentation,own,reduced:reduced.matches,valid:()=>active&&generation===currentGeneration,onBlast:()=>sound('hit')});
      } catch {} finally {if(generation===currentGeneration)animating=false;}
      if(!active||generation!==currentGeneration)return;
    }
    const changed=!previous||next.id!==previous.id||next.version!==previous.version||next.ready!==previous.ready;
    if (!active) {active=true;generation++;}
    if (next.id!==previous?.id || next.side!==previous?.side) {logOpen=false;fleet=[];bombs=[];placementTool='ships';mine=null;selectedShip=undefined;own=false;tool='shot';}
    state=next;
    if(changed)origin=null;
    onUpdate(next);
    const last=next.lastAction;
    const animate=previous?.id===next.id&&next.version>previous.version&&last&&last.version===next.version;
    draw();
    if(animate&&!next.handoff){
      const currentGeneration=generation;
      animating=true;draw();
      try {
        await animateNavalAttack({root,before:previous,after:next,own,reduced:reduced.matches,valid:()=>active&&generation===currentGeneration&&state===next,
          onImpact:()=>sound(last.kind==='scan'?'scan':last.hitCount?'hit':'splash')});
        await animateNavalBombs({root,after:next,own,reduced:reduced.matches,valid:()=>active&&generation===currentGeneration&&state===next,onBlast:()=>sound('hit')});
      } catch {
        // Полученная серверная позиция остаётся доступной при сбое визуального эффекта.
      } finally {
        if(active&&generation===currentGeneration&&state===next){animating=false;draw();}
      }
      if(!active||generation!==currentGeneration||state!==next)return;
      if(next.result&&!previous.result&&!reduced.matches){
        const reveal=root.querySelector('.naval-result')?.animate([{transform:'translateY(60px)',opacity:0},{transform:'translateY(0)',opacity:1}],{duration:240,easing:'ease-out'});
        if(reveal)await Promise.allSettled([reveal.finished]);
      }
    }
    if(next.result&&previous?.id===next.id&&!previous.result) sound(next.training==='local'||next.result===next.side?'win':'loss');
    schedule();
  }
  document.addEventListener('visibilitychange',()=>{if(active&&!document.hidden)schedule();});
  return {load,stop};
}
function randomFleet(excluded=[]) {
  for(;;) {
    const result=[];
    for(const size of sizes) {
      const options=[];
      for(let cell=0;cell<100;cell++)for(const step of [1,10]) {
        const ship=Array.from({length:size},(_,i)=>cell+i*step);
        if(ship.some(cell=>excluded.includes(cell)))continue;
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
