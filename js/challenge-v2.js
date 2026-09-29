'use strict';
/* Versioned finite-material challenges. Legacy quadrant rules stay untouched. */
const LEGACY_CHALLENGES = CHALLENGES.slice();
const V2Runtime = {
  active() { return !!G.v2; },
  // Executable non-crossing reference layout; placement always uses Input.tryPlace.
  layout(advanced, rotate, finalLevel) {
    const cells = [], seen = new Set();
    const add = (type,x,y,dir,mode) => {
      const key=x+','+y;
      if(seen.has(key)) throw new Error('Reference overlap '+key);
      seen.add(key); cells.push({type,x,y,dir,machineMode:mode||null});
    };
    const path = points => {
      for(let i=0;i<points.length-1;i++) {
        const [x,y]=points[i], [nx,ny]=points[i+1];
        if(Math.abs(nx-x)+Math.abs(ny-y)!==1) throw new Error('Reference gap');
        add('belt',x,y,nx>x?1:nx<x?3:ny>y?2:0);
      }
    };
    add('extractor',2,7,1);
    if(rotate) add('rotator',3,7,1); else add('belt',3,7,1);
    add('belt',4,7,1); add('cutter',5,7,1,'rough');
    path([[6,7],[6,6],[7,6],[8,6],[9,6],[9,7]]);
    path([[5,8],[6,8],[7,8],[8,8],[8,7],[9,7]]);
    add('cutter',9,7,1,'fine');
    const upper=advanced?3:7, lower=finalLevel?12:11;
    if(advanced) path([[10,7],[10,6],[10,5],[10,4],[10,3],[11,3],[12,3],[13,3]]);
    else path([[10,7],[11,7],[12,7],[13,7]]);
    const bottom=[];
    for(let y=8;y<=lower;y++) bottom.push([9,y]);
    for(let x=10;x<=13;x++) bottom.push([x,lower]);
    path(bottom);
    add('merger',13,upper,1,'half'); add('merger',13,lower,1,'half');
    const top=[];
    for(let x=14;x<=18;x++) top.push([x,upper]);
    if(advanced) for(let y=upper+1;y<=7;y++) top.push([18,y]);
    top.push([19,7]); path(top);
    const end=[];
    for(let x=14;x<=19;x++) end.push([x,lower]);
    for(let y=lower-1;y>=7;y--) end.push([19,y]);
    path(end);
    add('merger',19,7,1,'final'); path([[20,7],[21,7],[22,7]]);
    return cells;
  },
  load(index) {
    const def=CHALLENGES[index];
    G.mode='challenge'; G.chalIndex=index; G.chalDef=def; G.save.lastChal=index;
    setGridSize(24,16,32);
    G.grid=Array.from({length:16},()=>Array(24).fill(null));
    const make=(pair,i)=>Trapezoid.raw(pair,def.id+':'+i,def.orientation);
    G.v2={def,running:false,showGuide:!def.advanced,toolModes:{cutter:'rough',merger:'half'},
      initial:def.initial.map(make),reserve:def.reserve.map((p,i)=>make(p,def.initial.length+i)),
      orders:def.orders.map(o=>({...o,delivered:0})),deliveredItems:[],discardedItems:[],emitted:0};
    G.grid[7][1]={type:'resource',x:1,y:7,shapeType:make(def.initial[0],-1)};
    G.grid[7][22]=mkCell('hub',22,7,0);
    G.target=Trapezoid.preview(def.orders[0].recipeId);
    G.budget={...def.budget}; G.used={}; MACHINE_TYPES.forEach(t=>G.used[t]=0);
    G.tickCount=0; G.delivered=0; G.won=false; G.paused=false;
    G.chal={elapsed:0,done:false}; G.particles.length=0; G.hubPulse=0;
    G.stats.log.length=0; G.tool='belt'; G.toolDir=1; G.hover={x:-1,y:-1};
    G.paste=null; G.selMode=false; G.sel=null; G.clip=null; Undo.clear();
    if(!def.advanced) {
      for(const c of def.guide.filter(c=>c.type!=='belt'&&c.type!=='rotator')) {
        Input.tryPlace(c.x,c.y,c.type,c.dir,true);
        Object.assign(G.grid[c.y][c.x],{machineMode:c.machineMode,locked:true});
      }
      Undo.clear();
    }
    persist(); UI.refreshLevel(); UI.refreshBudget(); UI.refreshToolbar(); UI.syncPause();
    if(typeof UI.refreshV2==='function') UI.refreshV2();
  },
  installReference() {
    if(!G.v2) return;
    for(const c of G.v2.def.guide) {
      if(!cellAt(c.x,c.y)) Input.tryPlace(c.x,c.y,c.type,c.dir,true);
      G.grid[c.y][c.x].machineMode=c.machineMode;
    }
    Undo.clear();
  },
  resetMaterial() {
    if(!G.v2||G.won) return;
    const def=G.v2.def;
    for(const row of G.grid) for(const c of row) if(c) {
      for(const key of ['item','inA','inB','outA','outB','proc']) c[key]=null;
      c.queueA=[]; c.queueB=[]; c.cd=1; c.status=''; c.nextPort=0;
    }
    G.v2.initial=def.initial.map((p,i)=>Trapezoid.raw(p,def.id+':'+i,def.orientation));
    G.v2.reserve=def.reserve.map((p,i)=>Trapezoid.raw(p,def.id+':'+(def.initial.length+i),def.orientation));
    G.v2.deliveredItems=[]; G.v2.discardedItems=[]; G.v2.orders.forEach(o=>o.delivered=0);
    G.v2.running=false; G.v2.emitted=0; G.delivered=0; G.tickCount=0;
    G.chal.elapsed=0; G.stats.log.length=0; G.paused=false; G.hubPulse=0;
    UI.syncPause(); UI.refreshV2();
  },
  occupied(c) {
    return !!(c.item||c.inA||c.inB||c.outA||c.outB||c.proc||
      (c.queueA&&c.queueA.length)||(c.queueB&&c.queueB.length));
  },
  item(shape,c) { return {shape,fx:c.x,fy:c.y,moveTick:G.tickCount}; },
  materialIds() {
    if(!G.v2) return [];
    const shapes=[...G.v2.initial,...G.v2.reserve,...G.v2.deliveredItems,...G.v2.discardedItems];
    for(const row of G.grid) for(const c of row) if(c) {
      for(const key of ['item','inA','inB','outA','outB']) if(c[key]) shapes.push(c[key].shape);
      for(const key of ['queueA','queueB']) for(const it of c[key]||[]) shapes.push(it.shape);
      if(c.proc) { shapes.push(c.proc.shape); if(c.proc.shapeB) shapes.push(c.proc.shapeB); }
    }
    return shapes.flatMap(s=>s.units.map(u=>u.id));
  },
  accepts(c,sx,sy,it) {
    const d=DIRV[c.dir], back=sx===c.x-d[0]&&sy===c.y-d[1];
    const r=DIRV[(c.dir+1)%4], l=DIRV[(c.dir+3)%4];
    if(c.type==='hub') return Trapezoid.isFinished(it.shape,G.v2.def.finalRecipes)&&G.v2.orders.some(o=>o.recipeId===it.shape.recipeId&&o.delivered<o.need)?'consume':null;
    if(c.type==='belt') return !(sx===c.x+d[0]&&sy===c.y+d[1])&&!c.item?'item':null;
    if(c.type==='rotator') return back&&!(c.queueA||[]).length?'queueA':null;
    let port=null;
    if(back) port='queueA';
    if(c.type==='cutter'&&c.machineMode==='fine'&&sx===c.x+l[0]&&sy===c.y+l[1]) port='queueB';
    if(c.type==='merger'&&sx===c.x+r[0]&&sy===c.y+r[1]) port='queueB';
    if(!port||!['cutter','merger'].includes(c.type)) return null;
    return (c[port]||[]).length<4?port:null;
  },
  blockReason(dest,it) {
    if(!dest) return '下游未连接';
    if(dest.type==='hub') {
      if(!it.shape||it.shape.stage!=='finished') return '原坯或半块未完成切割与合并工序';
      if(!Trapezoid.isFinished(it.shape,G.v2.def.finalRecipes)) return '成品配方或方向不符';
      return '对应订单已满';
    }
    if(dest.type==='belt'&&dest.item) return '下游传送带已满';
    if(dest.type==='cutter'||dest.type==='merger'||dest.type==='rotator') return '下游入口未对齐或缓存已满';
    return '下游端口未连接';
  },
  tick() {
    if(!G.v2.running||G.paused||G.won) return;
    G.tickCount++;
    if(G.tickCount%MOVE_EVERY===0) this.movement();
    if(!G.won) this.machines();
  },
  movement() {
    // Snapshot sources prevents an item moving multiple cells in one tick.
    const sources=[];
    for(const row of G.grid) for(const c of row) if(c) {
      const slots=c.type==='belt'||c.type==='extractor'?['item']:['outA','outB'];
      for(const slot of slots) if(c[slot]) sources.push({c,slot,it:c[slot]});
    }
    for(const {c,slot,it} of sources) {
      if(G.won) break;
      const d=DIRV[slot==='outB'?(c.dir+1)%4:c.dir], dest=cellAt(c.x+d[0],c.y+d[1]);
      const port=dest&&this.accepts(dest,c.x,c.y,it);
      if(!port) { c.status=this.blockReason(dest,it); continue; }
      c[slot]=null; c.status='';
      if(port==='consume') {
        const order=G.v2.orders.find(o=>o.recipeId===it.shape.recipeId&&o.delivered<o.need);
        order.delivered++; G.v2.deliveredItems.push(it.shape); G.delivered++;
        G.stats.log.push(performance.now()); G.hubPulse=1; AudioFX.deliver();
        burst(dest.x,dest.y,'#ffd166',12);
        if(G.v2.orders.every(o=>o.delivered===o.need)) challengeWin();
      } else {
        it.fx=c.x; it.fy=c.y; it.moveTick=G.tickCount;
        if(port==='item') dest.item=it;
        else { if(!dest[port]) dest[port]=[]; dest[port].push(it); }
      }
    }
  },
  machines() {
    for(const row of G.grid) for(const c of row) if(c) {
      if(c.type==='extractor') {
        const adjacent=DIRV.some(d=>{const n=cellAt(c.x+d[0],c.y+d[1]);return n&&n.type==='resource';});
        if(!c.item&&adjacent&&--c.cd<=0) {
          const stock=G.v2.initial.length?G.v2.initial:G.v2.reserve;
          if(stock.length) { c.item=this.item(stock.shift(),c); G.v2.emitted++; c.cd=MOVE_EVERY; }
          else c.status='原坯已全部发出';
        }
        continue;
      }
      if(!['cutter','rotator','merger'].includes(c.type)) continue;
      if(c.proc) {
        if(--c.proc.t<=0) {
          c.outA=this.item(c.proc.shape,c);
          if(c.proc.shapeB) c.outB=this.item(c.proc.shapeB,c);
          c.proc=null;
        }
        continue;
      }
      if(c.outA||c.outB) continue;
      c.queueA=c.queueA||[]; c.queueB=c.queueB||[];
      if(c.type==='merger') {
        const all=c.queueA.concat(c.queueB).sort((a,b)=>
          (a.moveTick||0)-(b.moveTick||0)||
          (c.queueA.includes(a)?0:1)-(c.queueA.includes(b)?0:1)||
          String(a.shape.itemId).localeCompare(String(b.shape.itemId))); let match=null;
        for(let i=0;i<all.length&&!match;i++) for(let j=i+1;j<all.length&&!match;j++) {
          const a=all[i].shape,b=all[j].shape;
          if(c.machineMode==='half'&&a.stage!=='quarter') continue;
          if(c.machineMode==='final'&&a.stage!=='mixed-half') continue;
          const shape=Trapezoid.merge(a,b,G.v2.def.halfRecipes,G.v2.def.finalRecipes);
          if(shape) match={a:all[i],b:all[j],shape};
        }
        if(match) {
          c.queueA=c.queueA.filter(it=>it!==match.a&&it!==match.b);
          c.queueB=c.queueB.filter(it=>it!==match.a&&it!==match.b);
          c.proc={shape:match.shape,t:PROC_TICKS}; c.status='压合中';
        } else c.status=all.length?'等待配方配对：'+(c.machineMode==='half'?G.v2.def.halfRecipes:G.v2.def.finalRecipes).join('/'):'等待材料';
      } else {
        const choices=c.nextPort===1?['queueB','queueA']:['queueA','queueB'];
        const port=choices.find(p=>c[p].length);
        if(!port) { c.status='等待材料'; continue; }
        const shape=c[port][0].shape;
        const results=c.type==='rotator'?[Trapezoid.rotate(shape)]:
          c.machineMode==='fine'?Trapezoid.fine(shape):Trapezoid.rough(shape);
        if(!results) { c.status=shape.orientation?'原坯需转正：上底朝上':'材料阶段不符，检查粗切/精切模式'; continue; }
        c[port].shift(); c.nextPort=port==='queueA'?1:0;
        c.proc={shape:results[0],shapeB:results[1]||null,t:PROC_TICKS}; c.status='加工中';
      }
    }
  },
};

for(const [index,opts] of [
  [0,{name:'双切初识',initial:['AB','AB'],reserve:['AB'],orders:[{recipeId:'F_AB',need:3}],halfRecipes:['H_AB'],finalRecipes:['F_AB'],advanced:false,belt:56}],
  [1,{name:'三材调度',initial:['AB','AC','AB','AC'],reserve:['AB','AC'],orders:[{recipeId:'F_AB',need:3},{recipeId:'F_AC',need:3}],halfRecipes:['H_AB','H_AC'],finalRecipes:['F_AB','F_AC'],advanced:true,belt:72}],
  [4,{name:'转向重组',initial:['AB','AB','AB'],reserve:['AB'],orders:[{recipeId:'F_AB',need:4}],halfRecipes:['H_AB'],finalRecipes:['F_AB'],advanced:false,belt:64,orientation:270}],
  [5,{name:'四材终章',initial:['AB','CD','AB','CD','AB','CD'],reserve:['AB','CD'],orders:[{recipeId:'F_ABCD',need:8}],halfRecipes:['H_AB','H_CD'],finalRecipes:['F_ABCD'],advanced:true,belt:80}],
]) {
  const guide=V2Runtime.layout(opts.advanced,!!opts.orientation,index===5);
  const par=guide.filter(c=>c.type==='belt').length;
  CHALLENGES[index]={...opts,id:'C'+(index+1),ruleset:'trapezoid-v2',revision:2,orientation:opts.orientation||0,
    guide,par,need:opts.orders.reduce((n,o)=>n+o.need,0),target:Trapezoid.preview(opts.orders[0].recipeId),
    resources:[{x:1,y:7,type:opts.initial[0]}],hub:{x:22,y:7},
    budget:{belt:opts.belt,extractor:1,cutter:2,rotator:opts.orientation?1:0,merger:3,trash:0},
    hint:(opts.advanced?'进阶：自行布线，可开启参考路径。':'基础：沿参考路径铺带，机器已就位。')+
      (opts.orientation?'先用旋转机把横置原坯转正。':'')+
      '粗切→精切→异种1/4压合→两个混合半块压合。完成布线后启动供料；错误配方会保留材料。'+
      (index===5?'终合配方：H_AB＋H_CD。':'')+
      '三星≤'+Math.ceil(par*1.15)+'条带，二星≤'+Math.ceil(par*1.4)+'条带。',
    betterIsLower:true,scoreVal:g=>g.used.belt,scoreText:g=>g.delivered+' 个新成品 · '+g.used.belt+' 条传送带',
    stars:g=>g.delivered<g.chalDef.need?0:g.used.belt<=Math.ceil(par*1.15)?3:g.used.belt<=Math.ceil(par*1.4)?2:1};
}
