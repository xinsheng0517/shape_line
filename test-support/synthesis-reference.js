'use strict';
// Real-grid reference factories. No items are injected and resource coordinates
// remain the public challenge coordinates. Unused halves go to player trash.
function buildSynthesisReference(index) {
  V3Runtime.load(index);
  const def=G.chalDef;
  function place(type,x,y,dir=1,mode='auto') {
    if(!G.grid[y] || G.grid[y][x]) throw Error('reference cell occupied '+x+','+y);
    if(!(G.budget[type]>0)) throw Error('reference budget exhausted '+type);
    const c=mkCell(type,x,y,dir); c.machineMode=mode; G.grid[y][x]=c;
    G.used[type]++; if(G.budget[type]!==Infinity)G.budget[type]--;
    return c;
  }
  function route(points,endDir) {
    const cells=[];
    for(let i=0;i<points.length-1;i++) {
      let [x,y]=points[i]; const [tx,ty]=points[i+1];
      if(x!==tx&&y!==ty)throw Error('reference diagonal route');
      const dx=Math.sign(tx-x),dy=Math.sign(ty-y);
      const dir=dx===1?1:dx===-1?3:dy===1?2:0;
      while(x!==tx||y!==ty){cells.push([x,y,dir]);x+=dx;y+=dy;}
    }
    cells.push([...points[points.length-1],endDir]);
    for(const [x,y,dir] of cells)place('belt',x,y,dir);
  }
  function leftHorizontal(y) {
    place('extractor',3,y,1); place('belt',4,y,1);
    return place('cutter',5,y,1,'horizontal');
  }
  place('merger',12,10,2,'join');
  if(index===0) {
    leftHorizontal(3); place('trash',5,4);
    route([[6,3],[12,3],[12,9]],2);
    leftHorizontal(8); place('trash',6,8);
    route([[5,9],[11,9],[11,10]],1);
  } else if(index===4) {
    leftHorizontal(8); place('trash',5,9);
    route([[6,8],[12,8],[12,9]],2);
    leftHorizontal(13); place('trash',6,13);
    route([[5,14],[11,14],[11,10]],1);
  } else if(index===1) {
    leftHorizontal(3); place('trash',5,4);
    route([[6,3],[12,3],[12,9]],2);
    leftHorizontal(12); place('trash',6,12);
    route([[5,13],[6,13]],1); place('cutter',7,13,1,'vertical');
    place('trash',7,14);
    route([[8,13],[8,11],[9,11],[9,10],[11,10]],1);
    place('extractor',19,2,3); place('belt',18,2,3);
    place('cutter',17,2,3,'horizontal'); place('trash',16,2);
    route([[17,1],[16,1]],3); place('cutter',15,1,3,'vertical');
    place('trash',14,1);
    route([[15,0],[22,0],[22,14],[17,14]],0);
  } else if(index===5) {
    leftHorizontal(2); place('trash',5,3);
    route([[6,2],[7,2]],1); place('cutter',8,2,1,'vertical');
    place('trash',8,3); route([[9,2],[12,2],[12,9]],2);
    leftHorizontal(13); place('trash',6,13);
    route([[5,14],[11,14],[11,10]],1);
    place('extractor',19,2,3); place('belt',18,2,3);
    place('cutter',17,2,3,'horizontal'); place('trash',17,1);
    route([[16,2],[15,2]],3); place('cutter',14,2,3,'vertical');
    place('trash',13,2);
    route([[14,1],[14,0],[22,0],[22,14],[17,14]],0);
  } else throw Error('unsupported reference challenge');
  if(index===0 || index===4) {
    route([[12,11],[12,12],[20,12],[20,8]],1);
  } else {
    route([[12,11],[12,12],[16,12],[16,13]],1);
    place('merger',17,13,1,'join');
    route([[18,13],[19,13]],1);
  }
  return def;
}
if(typeof module!=='undefined'&&module.exports)module.exports=buildSynthesisReference;
