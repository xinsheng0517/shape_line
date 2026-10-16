'use strict';

const SynthesisEngine = (() => {
  const own = (obj,key) => Object.prototype.hasOwnProperty.call(obj,key);
  const copyTree = (value, seen=new Map()) => {
    if(!value||typeof value!=='object')return value;
    if(seen.has(value))return seen.get(value);
    const copy=Array.isArray(value)?[]:{};seen.set(value,copy);
    for(const key of Object.keys(value))Object.defineProperty(copy,key,{value:copyTree(value[key],seen),enumerable:true,configurable:true,writable:true});
    return copy;
  };
  const deepFreeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value); Object.values(value).forEach(deepFreeze);
    }
    return value;
  };
  const jsonCopy = value => {
    const visit = v => {
      if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
      if (typeof v === 'number' && Number.isFinite(v)) return;
      if (!v || typeof v !== 'object') throw Error('configuration-must-be-json');
      const prototype=Object.getPrototypeOf(v);
      if(!Array.isArray(v)&&prototype!==null&&Object.getPrototypeOf(prototype)!==null)throw Error('configuration-must-be-json');
      for (const child of Object.values(v)) visit(child);
    };
    visit(value); return JSON.parse(JSON.stringify(value));
  };
  function create(config = {}) {
    const maxCompileInputs=config.maxCompileInputs??1000000;
    if(!Number.isSafeInteger(maxCompileInputs)||maxCompileInputs<1)throw Error('invalid-configuration-budget');
    const slots = [...(config.layout?.slots || ['TL','BL','TR','BR'])];
    const clockwise = {...(config.layout?.clockwise || {TL:'TR',TR:'BR',BR:'BL',BL:'TL'})};
    if (!slots.length || new Set(slots).size!==slots.length || slots.some(s=>typeof s!=='string'||!own(clockwise,s)||!slots.includes(clockwise[s]))) throw Error('invalid-layout');
    let materials = new Map(), rules = new Map();
    const operators = new Map();
    const exact = new Map(), arityRules = new Map(), wildcard = new Map();
    const ruleTrie={children:new Map(),ids:new Set()};
    const planCache = new Map();
    const rankingCache = new Map();
    const poolIndexes = new WeakMap();
    let version = 0, candidateChecks = 0, cacheHits = 0, cacheMisses = 0, poolItems = 0, planningSerial = 0;
    const invalidate = () => { version++; planCache.clear(); rankingCache.clear(); };
    const keyOfMaterials = values => JSON.stringify([...values].sort());
    function materialRecord(id,descriptor) {
      if (typeof id!=='string'||!id.length||id==='*') throw Error('invalid-material-id');
      return deepFreeze({...jsonCopy(descriptor || {}),id});
    }
    function compileRule(def, registry=materials,work={remaining:maxCompileInputs}) {
      const rule = jsonCopy(def);
      if (typeof rule.id!=='string'||!rule.id||!Array.isArray(rule.inputs)||!rule.inputs.length) throw Error('invalid-rule');
      if (!['auto','join','stack','transform'].includes(rule.operation)&&!operators.has(rule.operation)) throw Error('unknown-operation');
      if(rule.operation==='transform'&&(!rule.output||!registry.has(rule.output.material)))throw Error('unknown-output-material');
      if (rule.priority!==undefined && !Number.isFinite(rule.priority)) throw Error('invalid-priority');
      if (rule.ordered!==undefined && typeof rule.ordered!=='boolean') throw Error('invalid-ordered');
      if (rule.enabled!==undefined && typeof rule.enabled!=='boolean') throw Error('invalid-enabled');
      const expanded=[];
      for (const input of rule.inputs) {
        if (!input || (input.material!=='*'&&!registry.has(input.material))) throw Error('unknown-material');
        const count=input.count===undefined?1:input.count;
        if (!Number.isSafeInteger(count)||count<1) throw Error('invalid-count');
        if(count>work.remaining)throw Error('configuration-budget-exceeded');
        work.remaining-=count;
        if (input.slot!==undefined&&!slots.includes(input.slot)) throw Error('invalid-slot');
        for(let i=0;i<count;i++) expanded.push({...input,count:1});
      }
      if (rule.conditions) {
        const supported=['minLayers','maxLayers','sameSource','disjoint'];
        if (Object.keys(rule.conditions).some(k=>!supported.includes(k))) throw Error('unknown-condition');
        for(const k of ['minLayers','maxLayers']) if(own(rule.conditions,k)&&(!Number.isSafeInteger(rule.conditions[k])||rule.conditions[k]<1)) throw Error('invalid-condition');
        for(const k of ['sameSource','disjoint']) if(own(rule.conditions,k)&&typeof rule.conditions[k]!=='boolean') throw Error('invalid-condition');
      }
      return {definition:deepFreeze(rule),expanded,hasWildcard:expanded.some(x=>x.material==='*'),key:keyOfMaterials(expanded.map(x=>x.material))};
    }
    function indexRule(compiled,add) {
      if(compiled.definition.enabled===false)return;
      const id=compiled.definition.id;
      const change=(map,key)=>{if(add){if(!map.has(key))map.set(key,new Set());map.get(key).add(id);}else{const bucket=map.get(key);if(bucket){bucket.delete(id);if(!bucket.size)map.delete(key);}}};
      change(arityRules,compiled.expanded.length);
      if(compiled.hasWildcard)change(wildcard,compiled.expanded.length);
      else {
        change(exact,compiled.key);
        const path=[];let node=ruleTrie;
        for(const material of compiled.expanded.map(i=>i.material).sort()){
          if(!node.children.has(material)){if(!add)break;node.children.set(material,{children:new Map(),ids:new Set()});}
          path.push([node,material]);node=node.children.get(material);
        }
        if(add)node.ids.add(id);else{node.ids.delete(id);for(let i=path.length-1;i>=0;i--){const [parent,key]=path[i],child=parent.children.get(key);if(child.ids.size||child.children.size)break;parent.children.delete(key);}}
      }
    }
    function registerMaterial(id,descriptor={}) { const record=materialRecord(id,descriptor);materials.set(id,record);invalidate();return record; }
    function registerRule(def,work) {const compiled=compileRule(def,materials,work);if(rules.has(def.id))indexRule(rules.get(def.id),false);rules.set(def.id,compiled);indexRule(compiled,true);invalidate();return def.id;}
    function unregisterRule(id){const rule=rules.get(id);if(!rule)return false;indexRule(rule,false);rules.delete(id);invalidate();return true;}
    function registerOperator(id,handler){if(typeof id!=='string'||!id||['auto','join','stack','transform','cut','rotate'].includes(id)||typeof handler!=='function')throw Error('invalid-operator');operators.set(id,handler);invalidate();}
    function worldUnits(item, physical=false) {
      let raw=Array.isArray(item)?item:item?.units;
      if(!raw&&Array.isArray(item?.layers))raw=item.layers.flatMap((layer,index)=>slots.filter(slot=>own(layer,slot)&&layer[slot]!=null).map(slot=>({shapeKind:layer[slot],quadrant:slot,layer:index})));
      if(!Array.isArray(raw)||!raw.length)throw Error('invalid-units');
      const angle=Array.isArray(item)?0:(item.orientation??0);
      if(!Number.isInteger(angle)||angle%90!==0)throw Error('invalid-orientation');
      const turns=((angle%360)+360)%360/90;
      const occupied=new Set();
      return raw.map(unit=>{
        if(!unit||typeof unit!=='object')throw Error('invalid-unit');
        let slot=unit.quadrant??unit.slot;
        if(!slots.includes(slot)||(unit.quadrant!==undefined&&unit.slot!==undefined&&unit.quadrant!==unit.slot))throw Error('invalid-slot');
        for(let n=0;n<turns;n++)slot=clockwise[slot];
        const layer=unit.layer??0;
        if(!Number.isSafeInteger(layer)||layer<0)throw Error('invalid-layer');
        if(typeof unit.shapeKind!=='string'||!materials.has(unit.shapeKind))throw Error('unknown-material');
        const originKind=unit.originKind??unit.shapeKind;
        if(typeof originKind!=='string'||!materials.has(originKind))throw Error('unknown-origin-material');
        if(physical&&((typeof unit.id!=='string'&&typeof unit.id!=='number')||String(unit.id)===''||(typeof unit.sourceId!=='string'&&typeof unit.sourceId!=='number')||String(unit.sourceId)===''))throw Error('invalid-identity');
        const position=JSON.stringify([layer,slot]);
        if(occupied.has(position))throw Error('slot-conflict');occupied.add(position);
        return {...unit,originKind,quadrant:slot,slot,layer};
      });
    }
    const structureKey=units=>JSON.stringify([slots,units.map(u=>[u.layer,u.slot,u.shapeKind]).sort((a,b)=>a[0]-b[0]||slots.indexOf(a[1])-slots.indexOf(b[1])||a[2].localeCompare(b[2]))]);
    function signature(item){try{return structureKey(worldUnits(item));}catch{return null;}}
    function matches(item,target){const key=signature(item);return key!==null&&key===signature(target);}
    function validateIdentity(items){const ids=new Set(),sources=new Map();for(const item of items)for(const u of item.units){if(ids.has(u.id))throw Error('duplicate-unit-id');ids.add(u.id);if(sources.has(u.sourceId)&&sources.get(u.sourceId)!==u.originKind)throw Error('source-material-conflict');sources.set(u.sourceId,u.originKind);}}
    function normalize(items){if(!Array.isArray(items)||!items.length)throw Error('invalid-inputs');const normalized=items.map(item=>({...item,orientation:0,units:worldUnits(item,true)}));validateIdentity(normalized);return normalized;}
    const itemMaterial=item=>item.units.every(u=>u.shapeKind===item.units[0].shapeKind)?item.units[0].shapeKind:null;
    const accepts=(req,item)=> (req.material==='*'||itemMaterial(item)===req.material)&&(!req.slot||item.units.every(u=>u.slot===req.slot));
    function conditionsPass(rule,items){const c=rule.definition.conditions;if(!c)return true;const units=items.flatMap(i=>i.units),depth=Math.max(...units.map(u=>u.layer))+1;if(c.minLayers&&depth<c.minLayers||c.maxLayers&&depth>c.maxLayers)return false;if(c.sameSource!==undefined&&(new Set(units.map(u=>u.sourceId)).size===1)!==c.sameSource)return false;if(c.disjoint!==undefined&&(new Set(units.map(u=>JSON.stringify([u.layer,u.slot]))).size===units.length)!==c.disjoint)return false;return true;}
    function pick(rule,items,partial=false,search={remaining:10000}){
      let buckets=poolIndexes.get(items);
      if(!buckets){buckets=new Map();const push=(key,index)=>{if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(index);};items.forEach((item,index)=>{const material=itemMaterial(item),slot=item.units.every(u=>u.slot===item.units[0].slot)?item.units[0].slot:null;push(JSON.stringify(['*',null]),index);if(material!==null)push(JSON.stringify([material,null]),index);if(slot!==null){push(JSON.stringify(['*',slot]),index);if(material!==null)push(JSON.stringify([material,slot]),index);}});poolIndexes.set(items,buckets);}
      const candidates=rule.expanded.map(req=>buckets.get(JSON.stringify([req.material,req.slot||null]))||[]);
      let selected=[];
      const condition=rule.definition.conditions||{};
      if(!partial&&(search.test||Object.keys(condition).length||rule.definition.operation==='join')){
        const occupied=new Set(),chosen=[],used=new Set();
        const disjoint=condition.disjoint===true||rule.definition.operation==='join';
        const find=(req,source)=>{
          if(search.remaining--<=0)throw Error('budget-exceeded');
          if(req===candidates.length)return conditionsPass(rule,chosen.map(i=>items[i]))&&(!search.test||search.test(rule.definition.ordered?[...chosen]:[...chosen].sort((a,b)=>a-b)));
          for(const index of candidates[req]){
            if(search.remaining--<=0)throw Error('budget-exceeded');
            if(used.has(index)||(rule.definition.ordered&&chosen.length&&index<=chosen[chosen.length-1]))continue;
            const units=items[index].units,sourceIds=new Set(units.map(u=>u.sourceId));
            if(condition.sameSource===true&&(sourceIds.size!==1||(source!==undefined&&!sourceIds.has(source))))continue;
            if(condition.maxLayers&&units.some(u=>u.layer>=condition.maxLayers))continue;
            const positions=units.map(u=>JSON.stringify([u.layer,u.slot]));
            if(disjoint&&positions.some(p=>occupied.has(p)))continue;
            used.add(index);chosen.push(index);if(disjoint)positions.forEach(p=>occupied.add(p));
            if(find(req+1,source===undefined?units[0].sourceId:source))return true;
            used.delete(index);chosen.pop();if(disjoint)positions.forEach(p=>occupied.delete(p));
          }return false;
        };
        if(!find(0,undefined))return null;
        return rule.definition.ordered?chosen:[...chosen].sort((a,b)=>a-b);
      }
      if(rule.definition.ordered){let after=-1;for(const choices of candidates){const index=choices.find(i=>i>after);if(index===undefined){if(partial)continue;return null;}selected.push(index);after=index;}}
      else if(candidates.every(choices=>choices===candidates[0])){
        // Identical demand buckets need one linear slice, not repeated
        // augmenting paths through all previous assignments.
        const count=partial?Math.min(rule.expanded.length,candidates[0].length):rule.expanded.length;
        if(candidates[0].length<count)return null;
        if(search.remaining<count)throw Error('budget-exceeded');search.remaining-=count;
        selected=candidates[0].slice(0,count);
      }
      else{
        // Bipartite matching handles overlapping exact/wildcard slot constraints
        // without enumerating combinations or greedily consuming the wrong item.
        const assigned=new Map();
        const assign=(req,seen)=>{for(const index of candidates[req]){if(search.remaining--<=0)throw Error('budget-exceeded');if(seen.has(index))continue;seen.add(index);if(!assigned.has(index)||assign(assigned.get(index),seen)){assigned.set(index,req);return true;}}return false;};
        for(let req=0;req<candidates.length;req++)if(!assign(req,new Set())&&!partial)return null;
        selected=[...assigned.keys()].sort((a,b)=>a-b);
      }
      if(!partial&&!conditionsPass(rule,selected.map(i=>items[i])))return null;
      return selected;
    }
    const ranked=ids=>{
      const list=[...ids],key=JSON.stringify(list);
      if(rankingCache.has(key))return rankingCache.get(key);
      const result=list.map(id=>rules.get(id)).filter(r=>r&&r.definition.enabled!==false).sort((a,b)=>(b.definition.priority||0)-(a.definition.priority||0)||b.expanded.length-a.expanded.length||a.definition.id.localeCompare(b.definition.id));
      if(rankingCache.size>=128)rankingCache.delete(rankingCache.keys().next().value);
      rankingCache.set(key,result);return result;
    };
    function matchingRule(items,explicit,search){
      if(explicit){const rule=rules.get(explicit);if(!rule)return null;candidateChecks++;return rule.expanded.length===items.length&&pick(rule,items,false,search)?rule:null;}
      const ids=new Set(exact.get(keyOfMaterials(items.map(itemMaterial)))||[]);for(const id of wildcard.get(items.length)||[])ids.add(id);
      for(const rule of ranked(ids)){if(rule.expanded.length!==items.length)continue;candidateChecks++;if(pick(rule,items,false,search))return rule;}return null;
    }
    function output(units,ruleId=null){
      const layers=[];for(const u of units){while(layers.length<=u.layer)layers.push({});layers[u.layer][u.slot]=u.shapeKind;}
      return deepFreeze({ok:true,units:copyTree(units),layers,key:structureKey(units),ruleId,orientation:0});
    }
    function arrangement(items,operation){
      const occupied=new Set(),offsets=[],highest=new Map();let top=-1;
      for(const item of items){let offset=operation==='stack'&&offsets.length?top+1:0;
        if(operation==='auto'&&offsets.length){
          const lowest=new Map();
          for(const unit of item.units) lowest.set(unit.slot,Math.min(lowest.get(unit.slot)??Infinity,unit.layer));
          // The whole upper structure descends together. Do not phase through a
          // higher occupied cell merely because a lower coordinate is empty.
          for(const [slot,layer] of lowest) if(highest.has(slot))
            offset=Math.max(offset,highest.get(slot)+1-layer);
        }
        const clashes=()=>item.units.some(u=>occupied.has(JSON.stringify([u.layer+offset,u.slot])));
        if(operation==='join'&&clashes())throw Error('slot-conflict');
        offsets.push(offset);for(const u of item.units){occupied.add(JSON.stringify([u.layer+offset,u.slot]));top=Math.max(top,u.layer+offset);highest.set(u.slot,Math.max(highest.get(u.slot)??-1,u.layer+offset));}
      }return offsets;
    }
    function combine(items,options={},workBudget){
      try{
        const normalized=normalize(items),mode=options.mode||'auto';
        if(options.ruleId&&rules.get(options.ruleId)?.definition.enabled===false)throw Error('rule-disabled');
        if(!['auto','join','stack'].includes(mode)||options.genericMode!==undefined&&!['auto','join','stack'].includes(options.genericMode))throw Error('unknown-mode');
        const search=workBudget||{remaining:options.maxCandidates??10000};
        if(!Number.isSafeInteger(search.remaining)||search.remaining<1)throw Error('budget-exceeded');
        const rule=matchingRule(normalized,options.ruleId,search);
        if(options.ruleId&&!rule)throw Error(rules.has(options.ruleId)?'rule-input-mismatch':'unknown-rule');
        if(normalized.length<2&&!rule)throw Error('insufficient-inputs');
        const operation=rule?.definition.operation||options.genericMode||mode;
        let units;
        if(operators.has(operation)){
          const safe=deepFreeze(copyTree(normalized));
          units=operators.get(operation)(safe,deepFreeze(copyTree({...options,rule:rule?.definition})),api);
          if(!Array.isArray(units)||units.length!==normalized.reduce((n,i)=>n+i.units.length,0))throw Error('unit-conservation');
          const original=new Map(normalized.flatMap(i=>i.units.map(u=>[u.id,u])));
          const seen=new Set();for(const u of units){const old=original.get(u.id);if(!old||seen.has(u.id)||old.sourceId!==u.sourceId||old.originKind!==u.originKind)throw Error('unit-conservation');seen.add(u.id);}
          units=worldUnits({units},true);
        }else{
          const cacheKey=JSON.stringify([version,operation,rule?.definition.id||null,normalized.map(i=>structureKey(i.units))]);
          let offsets=planCache.get(cacheKey);
          if(offsets){cacheHits++;}else{cacheMisses++;offsets=arrangement(normalized,operation==='transform'?'auto':operation);if(planCache.size>=2048)planCache.delete(planCache.keys().next().value);planCache.set(cacheKey,offsets);}
          units=normalized.flatMap((item,index)=>item.units.map(u=>({...u,layer:u.layer+offsets[index]})));
          if(operation==='transform')units=units.map(u=>({...u,shapeKind:rule.definition.output.material}));
        }
        return output(units,rule?.definition.id||null);
      }catch(error){return {ok:false,reason:error.message||'operator-failed'};}
    }
    function select(items,options={}){
      let normalized;try{normalized=normalize(items);}catch(error){return {ok:false,indices:[],reason:error.message};}
      poolItems+=normalized.length;
      const search={remaining:options.maxCandidates??10000};
      if(!Number.isSafeInteger(search.remaining)||search.remaining<1)return {ok:false,indices:[],reason:'budget-exceeded'};
      const ids=new Set();
      try{
      if(options.ruleId){if(!rules.has(options.ruleId))return {ok:false,indices:[],reason:'unknown-rule'};if(rules.get(options.ruleId).definition.enabled===false)return {ok:false,indices:[],reason:'rule-disabled'};ids.add(options.ruleId);}
      else{
        const counts=new Map();for(const item of normalized){const material=itemMaterial(item);if(material!==null)counts.set(material,(counts.get(material)||0)+1);}
        const available=[...counts.keys()].sort();
        const collect=(node,start)=>{if(search.remaining--<=0)throw Error('budget-exceeded');if(node.ids.size>search.remaining)throw Error('budget-exceeded');for(const id of node.ids){search.remaining--;ids.add(id);}for(let i=start;i<available.length;i++){const material=available[i];if(!counts.get(material)||!node.children.has(material))continue;counts.set(material,counts.get(material)-1);collect(node.children.get(material),i);counts.set(material,counts.get(material)+1);}};
        collect(ruleTrie,0);for(const [arity,bucket] of wildcard)if(arity<=normalized.length){if(bucket.size>search.remaining)throw Error('budget-exceeded');for(const id of bucket){search.remaining--;ids.add(id);}}
      }
      }catch(error){return {ok:false,indices:[],reason:error.message};}
      if(ids.size>search.remaining)return {ok:false,indices:[],reason:'budget-exceeded'};
      try{for(const rule of ranked(ids)){
        if(search.remaining--<=0)throw Error('budget-exceeded');
        candidateChecks++;
        let accepted=null,failedReason=null;
        if(operators.has(rule.definition.operation))search.test=indices=>{const test=search.test;delete search.test;const result=combine(indices.map(i=>items[i]),{...options,ruleId:rule.definition.id},search);search.test=test;if(result.ok){accepted=result;return true;}failedReason=result.reason;return false;};else delete search.test;
        const indices=pick(rule,normalized,false,search);
        if(indices){const result=accepted||combine(indices.map(i=>items[i]),{...options,ruleId:rule.definition.id},search);if(result.ok)return {ok:true,indices,result};if(options.ruleId)return {ok:false,indices:[],reason:result.reason};}
        if(failedReason&&options.ruleId)return {ok:false,indices:[],reason:failedReason};
      }}catch(error){return {ok:false,indices:[],reason:error.message};}
      if(options.ruleId)return {ok:false,indices:[],pending:true,reason:'waiting-for-rule-inputs'};
      if(normalized.length<2)return {ok:false,indices:[],pending:true,reason:'insufficient-inputs'};
      // The generic path is linear in the pool. Exact rule selection above never enumerates item combinations.
      if((options.genericMode||options.mode)==='join'){
        // Identical occupancy patterns need only one representative. This avoids
        // quadratic duplicate-queue work while still checking later compatible pairs.
        const shapes=new Map();normalized.forEach((item,index)=>{const key=JSON.stringify(item.units.map(u=>[u.layer,u.slot]).sort());if(!shapes.has(key))shapes.set(key,index);});
        const candidates=[...shapes.values()];
        for(let a=0;a<candidates.length;a++)for(let b=a+1;b<candidates.length;b++){if(search.remaining--<=0)return {ok:false,indices:[],reason:'budget-exceeded'};const indices=[candidates[a],candidates[b]],result=combine(indices.map(i=>items[i]),options);if(result.ok)return {ok:true,indices,result};if(result.reason==='budget-exceeded')return {ok:false,indices:[],reason:result.reason};}
      }else for(let i=1;i<items.length;i++){if(search.remaining--<=0)return {ok:false,indices:[],reason:'budget-exceeded'};const result=combine([items[0],items[i]],options);if(result.ok)return {ok:true,indices:[0,i],result};if(result.reason==='budget-exceeded')return {ok:false,indices:[],reason:result.reason};}
      return {ok:false,indices:[],reason:'no-compatible-inputs'};
    }
    function exportConfig(){return jsonCopy({materials:[...materials.values()],rules:[...rules.values()].map(r=>r.definition)});}
    function importConfig(snapshot){
      const data=jsonCopy(snapshot);
      if(!data||!Array.isArray(data.materials)||!Array.isArray(data.rules))throw Error('invalid-configuration');
      const nextMaterials=new Map(materials),nextRules=new Map(rules);
      const compileWork={remaining:maxCompileInputs};
      for(const descriptor of data.materials){const {id,...rest}=descriptor;nextMaterials.set(id,materialRecord(id,rest));}
      for(const definition of data.rules)nextRules.set(definition.id,compileRule(definition,nextMaterials,compileWork));
      materials=nextMaterials;rules=nextRules;exact.clear();arityRules.clear();wildcard.clear();ruleTrie.children.clear();ruleTrie.ids.clear();for(const rule of rules.values())indexRule(rule,true);invalidate();return exportConfig();
    }
    // Planner states contain structures, never live game objects. Source descriptions
    // are reusable supplies; every instantiated edge receives fresh planning IDs.
    function derive(target,{sources=[],maxStates=2000,maxDepth=30}={}){
      if(!Number.isSafeInteger(maxStates)||maxStates<1||!Number.isSafeInteger(maxDepth)||maxDepth<0)return {status:'budget-exceeded',steps:[],visited:0};
      let goal;try{goal=worldUnits(target);}catch(error){return {status:'unreachable',steps:[],visited:0,reason:error.message};}
      let visited=0,limited=false,depthLimited=false;
      const targetKey=structureKey(goal),nodes=[],seen=new Map();
      const sourceLineages=new Map(),unitLineages=new Map();
      const cuts=item=>['vertical','horizontal'].map(mode=>{
        const axis=mode==='vertical'?1:0,groups=mode==='vertical'?['L','R']:['T','B'];
        const outputs=groups.map(group=>({units:item.units.filter(u=>u.slot[axis]===group),orientation:0}));
        return {mode,outputs};
      }).filter(cut=>cut.outputs.every(piece=>piece.units.length)&&cut.outputs.reduce((n,p)=>n+p.units.length,0)===item.units.length);
      const virtual=(units,scope)=>{const serial=++planningSerial,sources=scope?.sources||new Map(),ids=scope?.ids;return {orientation:0,units:units.map((u,i)=>{
        const source=u.sourceId??JSON.stringify(['material',u.originKind??u.shapeKind]);
        const sourceKey=scope&&u.sourceId===undefined?JSON.stringify(['implicit',serial,source]):source;
        if(!sources.has(sourceKey)){
          const mapped=`plan-source-${serial}-${sources.size}`;sources.set(sourceKey,mapped);
          sourceLineages.set(mapped,sourceLineages.get(u.sourceId)??JSON.stringify([u.sourceId===undefined?'implicit-source':'root-source',source]));
        }
        const id=ids&&u.id!==undefined?(ids.has(u.id)?ids.get(u.id):(ids.set(u.id,`plan-${serial}-${i}`),ids.get(u.id))):`plan-${serial}-${i}`;
        unitLineages.set(id,unitLineages.get(u.id)??JSON.stringify(u.id===undefined?['implicit-unit',source,u.layer??0,u.slot??u.quadrant]:['root-unit',u.id]));
        return {...u,id,sourceId:sources.get(sourceKey)};
      })};};
      // Reusable supplies need fresh identities per use, but the complete
      // predecessor graph must be remapped together so each edge is executable.
      const instantiate=(node,scope={serial:++planningSerial,ids:new Map(),sources:new Map()})=>{
        const {serial,ids,sources}=scope;
        const item=original=>({...original,units:original.units.map(u=>{
          if(!ids.has(u.id)){const mapped=`plan-${serial}-${ids.size}`;ids.set(u.id,mapped);unitLineages.set(mapped,unitLineages.get(u.id));}
          if(!sources.has(u.sourceId)){const mapped=`plan-source-${serial}-${sources.size}`;sources.set(u.sourceId,mapped);sourceLineages.set(mapped,sourceLineages.get(u.sourceId));}
          return {...u,id:ids.get(u.id),sourceId:sources.get(u.sourceId)};
        })});
        const steps=node.steps.map(step=>({...step,inputs:step.inputs.map(item),output:item(step.output),...(step.outputs?{outputs:step.outputs.map(item)}:{})}));
        return {item:item(node.item),steps};
      };
      const itemIdentity=item=>JSON.stringify(worldUnits(item).map(u=>[u.id,u.sourceId,u.originKind,u.shapeKind,u.layer,u.slot]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
      const mergeInstances=instances=>{
        const steps=[],stepKeys=new Set(),available=new Set(),introduced=new Set();
        const consume=items=>{
          const inputIds=new Set();
          for(const item of items){const key=itemIdentity(item);
            if(item.units.some(u=>inputIds.has(u.id)))return false;
            item.units.forEach(u=>inputIds.add(u.id));
            if(!available.has(key)){
              if(item.units.some(u=>introduced.has(u.id)))return false;
              available.add(key);item.units.forEach(u=>introduced.add(u.id));
            }
          }
          items.forEach(item=>available.delete(itemIdentity(item)));return true;
        };
        for(const step of instances.flatMap(instance=>instance.steps)){
          const outputs=step.outputs||[step.output];
          const key=JSON.stringify([step.operation,step.mode,step.angle,step.ruleId,step.inputs.map(itemIdentity),outputs.map(itemIdentity)]);
          if(stepKeys.has(key))continue;
          if(!consume(step.inputs))return null;
          for(const item of outputs){available.add(itemIdentity(item));item.units.forEach(u=>introduced.add(u.id));}
          stepKeys.add(key);steps.push(step);
        }
        return consume(instances.map(instance=>instance.item))?steps:null;
      };
      const instantiateInputs=chosen=>{
        // Sibling fragments share the whole predecessor graph and its source
        // mapping. Conflicting branches require separate reusable supplies.
        const original=chosen.map(node=>({item:node.item,steps:node.steps})),originalSteps=mergeInstances(original);
        if(originalSteps)return {inputs:original.map(instance=>instance.item),steps:originalSteps};
        const scope={serial:++planningSerial,ids:new Map(),sources:new Map()};
        let instances=chosen.map(node=>instantiate(node,scope)),steps=mergeInstances(instances);
        if(!steps){instances=chosen.map(node=>instantiate(node));steps=mergeInstances(instances);}
        return steps?{inputs:instances.map(instance=>instance.item),steps}:null;
      };
      const stateIdentity=item=>{
        const sourceGroups=new Map(),units=worldUnits(item).sort((a,b)=>a.layer-b.layer||slots.indexOf(a.slot)-slots.indexOf(b.slot));
        return JSON.stringify([structureKey(units),units.map(u=>{
          if(!sourceGroups.has(u.sourceId))sourceGroups.set(u.sourceId,sourceGroups.size);
          return [u.originKind,sourceLineages.get(u.sourceId),unitLineages.get(u.id),sourceGroups.get(u.sourceId)];
        })]);
      };
      const budget=()=>{if(visited>=maxStates){limited=true;return false;}visited++;return true;};
      const add=(item,steps,depth)=>{const key=signature(item);if(!key)return null;const identity=stateIdentity(item);if(seen.has(identity))return null;if(depth>maxDepth){depthLimited=true;return null;}if(!budget())return null;const node={item,steps,depth,key};seen.set(identity,node);nodes.push(node);return node;};
      const finish=node=>({status:'found',steps:node.steps,visited,result:output(worldUnits(node.item))});
      const sourceScope={ids:new Map(),sources:new Map()};
      for(const source of sources){if(limited)break;try{const item=typeof source==='string'?virtual(slots.map(slot=>({shapeKind:source,slot,quadrant:slot,layer:0}))):virtual(worldUnits(source),sourceScope);add(item,[],0);}catch{}}
      const existingGoal=nodes.find(node=>node.key===targetKey);if(existingGoal)return finish(existingGoal);
      if(limited)return {status:'budget-exceeded',steps:[],visited};
      if(!nodes.length)return {status:limited?'budget-exceeded':'unreachable',steps:[],visited};
      const available=new Set(nodes.flatMap(n=>n.item.units.map(u=>u.shapeKind)));
      if(goal.some(u=>!available.has(u.shapeKind))&&!operators.size&&![...rules.values()].some(r=>r.definition.operation==='transform'))return {status:'unreachable',steps:[],visited,reason:'missing-source-material'};
      // Try actual registered unary transformations first, before the general decomposition.
      if((arityRules.get(1)?.size||0)>maxStates-visited)return {status:'budget-exceeded',steps:[],visited};
      for(const node of [...nodes])for(const rule of ranked(arityRules.get(1)||[])){
        if(!budget())break;if(!pick(rule,[node.item]))continue;const inputs=[node.item],result=combine(inputs,{ruleId:rule.definition.id});if(!result.ok)continue;
        const next=add(result,[{operation:rule.definition.operation,ruleId:rule.definition.id,inputs,output:result}],1);
        if(next?.key===targetKey)return finish(next);
      }
      // Geometry-directed decomposition uses real cuts, rotations and combines.
      // Each supply can be cut into its cells, which are then placed bottom-up.
      let built=null,steps=[],depth=0,decompositionOK=true;
      for(const desired of [...goal].sort((a,b)=>a.layer-b.layer||slots.indexOf(a.slot)-slots.indexOf(b.slot))){
        const supply=nodes.find(n=>n.depth===0&&n.item.units.some(u=>u.shapeKind===desired.shapeKind));
        if(!supply){decompositionOK=false;break;}
        const source=virtual(supply.item.units),cell=source.units.find(u=>u.shapeKind===desired.shapeKind);
        let piece=source;
        while(piece.units.length>1){const cut=cuts(piece).find(c=>c.outputs.find(p=>p.units.includes(cell))?.units.length<piece.units.length);
          if(!cut)break;
          if(!budget()){decompositionOK=false;break;}
          const input=piece;piece=cut.outputs.find(p=>p.units.includes(cell));steps.push({operation:'cut',mode:cut.mode,inputs:[input],outputs:cut.outputs,output:piece});depth++;
        }
        if(!decompositionOK)break;
        if(piece.units.length!==1){decompositionOK=false;break;}
        for(let turns=0;piece.units[0].slot!==desired.slot&&turns<4;turns++){
          if(!budget()){decompositionOK=false;break;}const old=piece;piece={units:worldUnits({...piece,orientation:90}),orientation:0};steps.push({operation:'rotate',angle:90,inputs:[old],output:piece});depth++;
        }
        if(!decompositionOK||piece.units[0].slot!==desired.slot){decompositionOK=false;break;}
        if(built){if(!budget()){decompositionOK=false;break;}const result=combine([built,piece]);if(!result.ok){decompositionOK=false;break;}steps.push({operation:result.ruleId?rules.get(result.ruleId).definition.operation:'auto',ruleId:result.ruleId,inputs:[built,piece],output:result});built=result;depth++;}else built=piece;
        if(depth>maxDepth){depthLimited=true;decompositionOK=false;break;}
      }
      if(decompositionOK&&built&&signature(built)===targetKey)return {status:'found',steps,visited,result:output(worldUnits(built))};
      // Bounded structural closure. Rules are evaluated against dynamically found
      // states; no material-specific recipe or prewritten process script exists.
      let unaryCursor=0;
      for(let cursor=0;cursor<nodes.length&&!limited;cursor++){
        // Saturate cheap unary edges before expanding Cartesian multi-input
        // choices. A two-cut route must not wait behind thousands of pairs.
        while(unaryCursor<nodes.length&&!limited){
          const node=nodes[unaryCursor++];
          if(node.depth>=maxDepth){depthLimited=true;continue;}
          const unary=[];
          for(const rule of ranked(arityRules.get(1)||[])){if(!budget())break;if(!pick(rule,[node.item]))continue;const inputs=[node.item],result=combine(inputs,{ruleId:rule.definition.id});if(result.ok)unary.push({item:result,inputs,operation:rule.definition.operation,ruleId:rule.definition.id});}
          unary.push({item:{units:worldUnits({...node.item,orientation:90})},operation:'rotate',angle:90});
          for(const cut of cuts(node.item))for(const piece of cut.outputs)unary.push({item:piece,operation:'cut',mode:cut.mode,outputs:cut.outputs});
          for(const next of unary){const step={operation:next.operation,ruleId:next.ruleId,inputs:next.inputs||[node.item],output:next.item};if(next.operation==='rotate')step.angle=90;if(next.operation==='cut'){step.outputs=next.outputs;step.mode=next.mode;}const added=add(next.item,[...node.steps,step],node.depth+1);if(added?.key===targetKey)return finish(added);if(limited)break;}
        }
        if(limited)break;
        const node=nodes[cursor];if(node.depth>=maxDepth)continue;
        const current=[...nodes];
        const activeRules=[...arityRules].reduce((count,[arity,ids])=>count+(arity>1?ids.size:0),0);
        if(activeRules>maxStates-visited){limited=true;break;}
        const recipes=[...ranked(rules.keys()).filter(r=>r.expanded.length>1),{expanded:[{material:'*'},{material:'*'}],definition:{operation:'auto'}}];
        for(const rule of recipes){
          if(!budget())break;
          if(!rule.expanded.some(req=>accepts(req,node.item)))continue;
          const choices=[];for(const req of rule.expanded){if(!budget())break;choices.push(current.filter(n=>accepts(req,n.item)));}
          if(limited)break;
          if(choices.some(list=>!list.length))continue;
          const visit=(chosen,index)=>{
            if(limited)return;
            if(!budget())return;
            if(index<choices.length){
              // Identical requirements are symmetric in unordered recipes.
              const previous=index>0&&!rule.definition.ordered&&JSON.stringify(rule.expanded[index])===JSON.stringify(rule.expanded[index-1])?current.indexOf(chosen[index-1]):-1;
              for(const choice of choices[index]){if(current.indexOf(choice)<previous)continue;visit([...chosen,choice],index+1);if(limited||found)break;}return;
            }
            if(!chosen.includes(node))return;
            const d=Math.max(...chosen.map(n=>n.depth))+1;if(d>maxDepth){depthLimited=true;return;}
            const instance=instantiateInputs(chosen);if(!instance)return;
            const {inputs,steps}=instance,result=combine(inputs,{ruleId:rule.definition.id});if(!result.ok)return;
            const next=add(result,[...steps,{operation:rule.definition.operation,ruleId:rule.definition.id,inputs,output:result}],d);
            if(next?.key===targetKey)found=next;
          };let found=null;visit([],0);if(found)return finish(found);if(limited)break;
        }
      }
      return {status:limited||depthLimited?'budget-exceeded':'unreachable',steps:[],visited};
    }
    const api=Object.freeze({get version(){return version;},get revision(){return version;},registerMaterial,getMaterial:id=>materials.get(id)||null,registerRule,unregisterRule,registerOperator,combine,signature,matches,select,derive,exportConfig,importConfig,listRules:()=>jsonCopy([...rules.values()].map(r=>r.definition)),stats:()=>({candidateChecks,cacheHits,cacheMisses,poolItems,version,rules:rules.size,materials:materials.size,cacheEntries:planCache.size})});
    const initialMaterials=Array.isArray(config.materials)?config.materials:Object.entries(config.materials||{}).map(([id,descriptor])=>({id,...descriptor}));
    for(const descriptor of initialMaterials){const {id,...rest}=descriptor;registerMaterial(id,rest);}
    const initialCompileWork={remaining:maxCompileInputs};
    for(const rule of config.rules||[])registerRule(rule,initialCompileWork);
    return api;
  }
  return Object.freeze({create});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=SynthesisEngine;
