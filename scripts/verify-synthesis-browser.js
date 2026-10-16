'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..');
const target=path.resolve(process.argv[2]||path.join(root,'index.html'));
const out=path.join(root,'docs/superpowers/reports/browser');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.SYNTHESIS_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(pathToFileURL(target).href);
  await page.locator('#mode-challenge').click();
  await page.locator('#tool-merger').click();
  let point=await page.evaluate(()=>Render.gridToPx(10.5,10.5));
  await page.mouse.click(point.x,point.y);
  assert.equal(await page.evaluate(()=>cellAt(10,10)?.type),'merger','real toolbar/canvas placement');
  await page.locator('[title="蓝图库／导入导出"]').click();
  await page.locator('summary').filter({hasText:'编辑 / 导入 / 导出材料与规则 JSON'}).click();
  const config=await page.evaluate(()=>PetalV3.engine.exportConfig());
  config.materials.push({id:'copper',name:'铜',color:'#dc8752',outline:'diamond'});
  config.rules.push({id:'copper-three',name:'三输入铜拼接',inputs:[{material:'copper',count:3}],operation:'join'});
  await page.locator('#synthesis-config-text').fill(JSON.stringify(config));
  await page.getByRole('button',{name:'校验并应用 JSON'}).click();
  assert.equal(await page.evaluate(()=>PetalV3.engine.getMaterial('copper').name),'铜');
  await page.reload();
  assert.equal(await page.evaluate(()=>PetalV3.engine.getMaterial('copper')?.name),'铜','configuration survives reload');
  await page.locator('#mode-challenge').click();
  await page.evaluate(()=>{
   const c=mkCell('merger',10,10,1);c.machineMode='auto';G.grid[10][10]=c;
   G.used.merger++;G.v3.selected={x:10,y:10};UI.bpOpen=true;UI.refreshBps();
  });
  await page.locator('#synthesis-rule').selectOption('copper-three');
  const nary=await page.evaluate(()=>{
   const c=cellAt(10,10),a=mkCell('belt',9,10,1),b=mkCell('belt',10,11,0);
   G.grid[10][9]=a;G.grid[11][10]=b;
   function q(id,slot){return PetalV3.cut(PetalV3.raw('copper',id),'vertical')
    .flatMap(half=>PetalV3.cut(half,'horizontal')).find(piece=>piece.quadrant===slot);}
   function step(n){for(let i=0;i<n;i++)V3Runtime.tick();}
   a.item=V3Runtime.item(q('browser-1','TL'),a);step(2);
   a.item=V3Runtime.item(q('browser-2','BL'),a);step(2);
   const waited=!c.proc&&!c.outA&&c.queueA.length===2;
   b.item=V3Runtime.item(q('browser-3','TR'),b);step(12);G.paused=true;
   UI.refreshBps();Render.draw(0);
   return {waited,rule:c.ruleId,output:c.outA?.shape.units.length};
  });
  assert.deepEqual(nary,{waited:true,rule:'copper-three',output:3});
  await page.evaluate(()=>{
   V3Runtime.load(0);const c=mkCell('merger',10,10,1);c.machineMode='auto';G.grid[10][10]=c;
   c.outA=V3Runtime.item(PetalV3.merge(PetalV3.raw('T','layer-T'),PetalV3.raw('C','layer-C')),c);
   G.v3.selected={x:10,y:10};G.paused=true;UI.bpOpen=true;UI.refreshBps();Render.draw(0);
  });
  await page.getByRole('button',{name:'查看每层结构'}).click();
  assert.equal(await page.locator('.synthesis-layer').count(),2);
  await page.screenshot({path:path.join(out,path.basename(target)+'.layers.png')});
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'test-support/synthesis-reference.js'),'utf8')});
  const references=await page.evaluate(()=>{
   UI.bpOpen=false;UI.refreshBps();
   return [0,1,4,5].map(index=>{
    const def=buildSynthesisReference(index);
    for(let i=0;i<4000&&!G.won;i++)V3Runtime.tick();
    const result={id:def.id,delivered:G.delivered,need:def.need,ticks:G.tickCount,
     belts:G.used.belt,discardOnlyTrash:G.v3.discardReasons.every(record=>record.reason==='玩家垃圾桶')};
    return result;
   });
  });
  for(const row of references){assert.equal(row.delivered,row.need,row.id);assert(row.discardOnlyTrash);}
  await page.evaluate(()=>{buildSynthesisReference(0);for(let i=0;i<4000&&!G.won;i++)V3Runtime.tick();UI.hideModal();UI.refreshChalProgress();G.paused=true;Render.draw(0);});
  await page.screenshot({path:path.join(out,path.basename(target)+'.c1.png')});
  await page.setViewportSize({width:896,height:414});
  await page.evaluate(()=>Render.resize());
  await page.screenshot({path:path.join(out,path.basename(target)+'.mobile.png')});
  assert.deepEqual(errors,[],'browser console and runtime errors');
  console.log(JSON.stringify({target,nary,references,errors,screenshots:out},null,2));
  console.log('ALL_SYNTHESIS_BROWSER_PASS');
  await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
