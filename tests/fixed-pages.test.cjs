'use strict';
const assert=require('node:assert/strict');
const core=require('../fixed-pages-core.js');
const sizes={};
const ids=Array.from({length:45},(_,i)=>'p-'+String(i+1).padStart(3,'0'));
ids.forEach((id,i)=>sizes[id]={width:947,height:i%8===0?380:100+i%6*15});
const opt=(maxPages,answerMode,maxQuestions=15,minQuestions=0)=>({maxPages,answerMode,maxQuestions,minQuestions});
function inspect(result,cap){
 assert(result.ids.length>0&&result.ids.length<=45);
 assert.equal(new Set(result.ids).size,result.ids.length);
 assert(result.layout.pageCount<=cap);
 assert.equal(result.layout.pageCount,result.layout.pages.length);
 assert.deepEqual(result.layout.questions,result.ids);
 assert(result.layout.pages.at(-1).answer,'answer must be on the last sheet');
 assert(result.layout.pages.at(-1).answer.y+result.layout.pages.at(-1).answer.height<=core.PAGE.bottom);
 let total=0;
 for(const p of result.layout.pages){
  let prev=core.PAGE.top;
  for(const q of p.questions){
   assert(q.y>=prev-0.001, 'question overlaps preceding item');
   assert(q.y+q.height<=core.PAGE.bottom+0.001, 'question exceeds printable area');
   prev=q.y+q.height+core.PAGE.gap;total++;
  }
  if(p.answer&&p.questions.length)assert(prev<=p.answer.y-2,'answer overlaps a question');
 }
 assert.equal(total,result.ids.length);
}
let n=0;
for(const mode of ['separate','inline']){
 for(let pages=1;pages<=8;pages++){
  for(const target of [1,5,10,15,25,45]){
   if(mode==='separate'&&pages===1){
    assert.throws(()=>core.choose([],ids,sizes,opt(pages,mode,target)),/至少須為2頁/);n++;continue;
   }
   const result=core.choose([],ids,sizes,opt(pages,mode,target));
   inspect(result,pages);n++;
  }
 }
}
assert.throws(()=>core.layout(['p-001','p-001'],sizes,opt(3,'inline')),/重複題號/);n++;
assert.throws(()=>core.layout(['nonexistent'],sizes,opt(2,'inline')),/圖像尺寸/);n++;
const large={a:{width:900,height:1200},b:{width:900,height:1300}};
assert.throws(()=>core.choose(['a','b'],[],large,opt(2,'separate',2,2)),/最低單元題數無法/);n++;
const quota=core.choose(ids.slice(0,3),ids.slice(3),sizes,opt(2,'separate',3,3));
assert.equal(quota.ids.length,3);inspect(quota,2);n++;
assert.throws(()=>core.choose([],ids.slice(0,10),sizes,opt(2,'separate',15,15)),/低於你要求/);n++;
console.log('Fixed-page tests passed:',n,'cases');
