/* Physics Analyze: deterministic, browser-independent A4 page packing. */
(function(root,factory){
 'use strict';
 const core=factory();
 if(typeof module==='object'&&module.exports)module.exports=core;
 root.PhysicsFixedCore=core;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const PAGE={width:210,height:297,top:43,bottom:278,imageX:25,imageWidth:171,gap:5.5};
 function integer(value,min,max,name){
  const x=Number(value);
  if(!Number.isInteger(x)||x<min||x>max)throw Error(name+'須介於 '+min+'～'+max+'。');
  return x;
 }
 function answerHeight(n){return 22+Math.ceil(n/6)*9;}
 function dimensions(sizes,id){
  const m=sizes[id];
  if(!m||!Number.isFinite(+m.width)||!Number.isFinite(+m.height)||+m.width<=0||+m.height<=0)
   throw Error('題目 '+id+' 缺少有效圖像尺寸，為避免超頁，不可排版。');
  return {id,height:PAGE.imageWidth*(+m.height)/(+m.width),width:PAGE.imageWidth};
 }
 function tryPack(ids,sizes,options,pageCount){
  const separate=options.answerMode==='separate',height=answerHeight(ids.length);
  if(separate&&pageCount<2)return null;
  const questionPages=pageCount-(separate?1:0);
  if(questionPages<1)return null;
  const bins=Array.from({length:questionPages},(_,index)=>({
   index:index+1,y:PAGE.top,
   maxY:PAGE.bottom-(!separate&&index===questionPages-1?height+8:0),
   items:[]
  }));
  const items=ids.map(id=>dimensions(sizes,id));
  // First-fit decreasing reorders complete questions; it never crops, splits, or scales a question.
  if(!options.preserveOrder)items.sort((a,b)=>b.height-a.height||ids.indexOf(a.id)-ids.indexOf(b.id));
  let currentBin=0;
  for(const item of items){
   if(item.height>PAGE.bottom-PAGE.top-PAGE.gap)return null;
   let bin;
   if(options.preserveOrder){
    while(currentBin<bins.length&&bins[currentBin].y+item.height+PAGE.gap>bins[currentBin].maxY+0.000001)currentBin++;
    bin=bins[currentBin];
   }else{
    bin=bins.find(b=>b.y+item.height+PAGE.gap<=b.maxY+0.000001);
   }
   if(!bin)return null;
   bin.items.push({id:item.id,y:bin.y,height:item.height,width:item.width});
   bin.y+=item.height+PAGE.gap;
  }
  // All question pages up to the last are used for a minimal-page successful packing.
  const pages=bins.map(b=>({page:b.index,questions:b.items,answer:null}));
  if(separate)pages.push({page:pageCount,questions:[],answer:{y:54,height}});
  else pages[pages.length-1].answer={y:PAGE.bottom-height,height};
  let order=0;
  pages.forEach(p=>p.questions.forEach(q=>{q.number=++order;}));
  return {pageCount,questionCount:ids.length,questions:pages.flatMap(p=>p.questions.map(q=>q.id)),
    answerHeight:height,answerMode:options.answerMode,pages};
 }
 function layout(ids,sizes,options){
  if(!Array.isArray(ids)||!ids.length)throw Error('至少需要一題。');
  if(new Set(ids).size!==ids.length)throw Error('發現重複題號，排版已中止。');
  const maxPages=integer(options.maxPages,1,10,'頁數上限');
  const mode=options.answerMode||'separate';
  if(mode!=='separate'&&mode!=='inline')throw Error('答案排版方式無效。');
  if(mode==='separate'&&maxPages<2)throw Error('答案獨立一頁時，頁數上限至少須為2頁。');
  const setting={answerMode:mode,preserveOrder:options.preserveOrder===true};
  for(let pages=options.exactPages===true?maxPages:1;pages<=maxPages;pages++){
   const result=tryPack(ids,sizes,setting,pages);
   if(result)return result;
  }
  return null;
 }
 function choose(required,candidates,sizes,options){
  const wanted=integer(options.maxQuestions,1,45,'期望題數');
  const least=integer(options.minQuestions??0,0,45,'至少題數');
  if(least>wanted)throw Error('至少題數不可超過期望題數。');
  const must=[...new Set(required)],chosen=must.slice(),used=new Set(must);
  if(must.length!==required.length)throw Error('最低單元題目重複，無法排版。');
  if(must.length>wanted)throw Error('各單元最低題數總和超過期望題數。');
  if(must.length&&!layout(must,sizes,options))
   throw Error('指定的各單元最低題數無法在目前頁數內完整排入（含答案）。請降低最低題數或調整配題單元。');
  let checked=0,skipped=0;
  for(const id of candidates){
   if(chosen.length>=wanted)break;
   if(used.has(id))continue;
   used.add(id);checked++;
   if(layout([...chosen,id],sizes,options))chosen.push(id);
   else skipped++;
  }
  if(!chosen.length)throw Error('選定範圍內沒有任何題目能在指定頁數內完整排入。');
  if(chosen.length<least)throw Error('實際僅能排入 '+chosen.length+' 題，低於你要求的至少 '+least+' 題。請降低最低題數或調整單元範圍。');
  const result=layout(chosen,sizes,options);
  if(!result)throw Error('無法產生符合頁數的版面，請調整設定。');
  return {ids:result.questions,layout:result,skipped,checked,requested:wanted,reached:result.questions.length===wanted};
 }
 return {PAGE,answerHeight,layout,choose};
});
