'use strict';

// C1 screenshot fixture: all production items come from a real extractor and
// three real cutters. No quarter, queue item or output is injected.
// top/T reproduces the screenshot coordinates exactly. C/S are test fixtures:
// clone the C1 definition, change only source (2,3), and regenerate its stock.
// bottom keeps the same belts but faces the two secondary cutters north, using
// their east-facing outB for BL/BR and discarding their north-facing outA.
function buildRowSplicingReference({material='T',row='top',connectOutput:outputInitiallyConnected=false,connectLower=true}={}) {
  if(!['T','C','S'].includes(material)) throw Error('unsupported row fixture material');
  if(!['top','bottom'].includes(row)) throw Error('unsupported row fixture row');
  V3Runtime.load(0);

  if(material!=='T') {
    const original=G.v3.def;
    const def={...original,resources:original.resources.map((resource,index)=>
      index===0?{...resource,type:material}:{...resource})};
    G.v3.def=def; G.chalDef=def;
    G.grid[3][2].shapeType=material;
    Object.assign(G.v3,V3Runtime.supply(def));
  }

  function place(type,x,y,dir=1,mode='auto') {
    if(!G.grid[y] || G.grid[y][x]) throw Error('row reference cell occupied '+x+','+y);
    if(!(G.budget[type]>0)) throw Error('row reference budget exhausted '+type);
    const cell=mkCell(type,x,y,dir);
    if(type==='cutter'||type==='merger') cell.machineMode=mode;
    G.grid[y][x]=cell; G.used[type]++;
    if(G.budget[type]!==Infinity) G.budget[type]--;
    return cell;
  }
  function placeOnce(type,x,y,dir=1) {
    const existing=G.grid[y] && G.grid[y][x];
    if(!existing) return place(type,x,y,dir);
    if(existing.type!==type || existing.dir!==dir)
      throw Error('row reference connection occupied '+x+','+y);
    return existing;
  }

  const extractor=place('extractor',3,3);
  place('belt',4,3);
  const primaryCutter=place('cutter',5,3);
  place('belt',6,3); place('belt',7,3);
  const upperCutter=place('cutter',8,3,row==='top'?1:0);
  place('trash',8,row==='top'?4:2);

  place('belt',5,4,2); place('belt',5,5); place('belt',6,5);
  const lowerCutter=place('cutter',7,5,row==='top'?1:0);
  place('trash',7,row==='top'?6:4);

  place('belt',9,3); place('belt',10,3,2);
  place('belt',10,4); place('belt',11,4);
  place('belt',8,5); place('belt',9,5);
  place('belt',10,5); place('belt',11,5);
  const merger=place('merger',12,4);

  function completeLower() { return placeOnce('belt',12,5,0); }
  function connectOutput() {
    const belt=placeOnce('belt',13,4);
    const trash=placeOnce('trash',14,4);
    return {belt,trash};
  }
  if(connectLower) completeLower();
  if(outputInitiallyConnected) connectOutput();

  const slots=row==='top'?['TL','TR']:['BL','BR'];
  const target={layers:[Object.fromEntries(slots.map(slot=>[slot,material]))]};
  return {
    merger,extractor,primaryCutter,upperCutter,lowerCutter,
    material,row,target,completeLower,connectOutput,
    // The other cutter quarters also go to trash; filter out that scrap.
    products:()=>G.v3.discardedItems.filter(shape=>PetalV3.matches(shape,target)),
  };
}
if(typeof module!=='undefined'&&module.exports)module.exports=buildRowSplicingReference;
