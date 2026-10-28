'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('../fixed-pages-core.js');
const source=fs.readFileSync(path.join(__dirname,'../features.js'),'utf8');
const start=source.indexOf('const BATCH_PAGES=2;');
const stop=source.indexOf('async function runBatch(){',start);
assert(start>=0&&stop>start,'Batch compositor is missing');
const code=source.slice(start,stop);

async function verify(){
 const students=['815-01','815-02'];
 const items={};
 for(let person=0;person<students.length;person++){
  for(let i=0;i<32;i++){
   const id=person===0&&i===0?'P31-017':'q'+person+'-'+i;
   items[id]={image_width:900,image_height:90,actualWidth:900,
    actualHeight:id==='P31-017'?570:i%6===0?310:100,answer_as_provided:'A'};
  }
 }
 const API={
  question:id=>items[id],
  imageBlob:async id=>items[id]?{id}:null,
  usableQuestionCount:()=>32,
  planQuestions:(n,topics,student)=>({ids:Array.from({length:n},(_,i)=>
   i===0&&student==='815-01'?'P31-017':'q'+students.indexOf(student)+'-'+i)})
 };
 let decoding=0;
 const createImageBitmap=async blob=>{decoding++;return {
  width:items[blob.id].actualWidth,height:items[blob.id].actualHeight,close(){}
 }};
 const drawn=[];let pdf;
 class PDF{
  constructor(){this.pageCount=1;pdf=this;this.internal={getNumberOfPages:()=>this.pageCount};}
  addPage(){this.pageCount++;}
  addImage(data,format,x,y,w,h){drawn.push({page:this.pageCount,format,x,y,w,h});}
  setFont(){}setFontSize(){}setTextColor(){}text(){}
 }
 const ctx={fillRect(){},strokeRect(){},fillText(){}};
 const document={createElement:()=>({
  width:1,height:1,getContext:()=>ctx,toDataURL:()=> 'png'
 })};
 let downloads=0;
 const engine=new Function(
  'API','window','createImageBitmap','document','getJpeg','headerPng',
  'clearPreparedPdf','snapshot','setBusy','offerPdfDownload','toast','setTimeout',
  code+'\nreturn {getDimensions,prepareBatchPlans,layoutOf,combinedPdf};'
 )(
  API,{PhysicsFixedCore:core,jspdf:{jsPDF:PDF}},createImageBitmap,document,
  async id=>({width:items[id].actualWidth,height:items[id].actualHeight,data:'jpg'}),
  ()=> 'header',()=>{},()=>({ready:true}),()=>{},
  ()=>{downloads++;return {bytes:2048,pages:pdf.pageCount};},
  ()=>{},callback=>callback()
 );

 const actual=await engine.getDimensions('P31-017',new Map());
 assert.deepEqual(actual,{width:900,height:570},'Must use decoded WebP, not incorrect metadata');
 const plans=await engine.prepareBatchPlans(students,16,'2026-10-28',['U']);
 assert.equal(plans.length,2);
 for(const plan of plans){
  assert.equal(plan.layout.pageCount,2);
  assert.equal(plan.layout.answerMode,'inline');
  assert.deepEqual(plan.layout.questions,plan.questionIds);
  assert(plan.layout.pages[1].answer);
 }
 assert(plans[0].questionIds.includes('P31-017'));
 const papers=plans.map(p=>({
  student:p.student,questionIds:p.questionIds,title:p.student,minutes:25,
  trainingDate:'2026-10-28',
  fixedPages:{pageCount:2,answerMode:'inline',layout:p.layout}
 }));
 await engine.combinedPdf(papers);
 assert.equal(pdf.pageCount,students.length*2);
 assert.deepEqual(drawn.filter(x=>x.format==='PNG'&&x.x===12).map(x=>x.page),[2,4]);
 assert.equal(drawn.filter(x=>x.format==='JPEG').length,
  papers.reduce((sum,p)=>sum+p.questionIds.length,0));
 assert.equal(downloads,1);

 // Existing batches created from incorrect catalog dimensions are reflowed,
 // preserving all original questions and their numbering.
 const oldSizes=Object.fromEntries(plans[0].questionIds.map(id=>[id,{width:900,height:90}]));
 const stale=core.layout(plans[0].questionIds,oldSizes,{
  maxPages:2,exactPages:true,answerMode:'inline',preserveOrder:true
 });
 assert(stale,'Legacy test layout must exist');
 const revised=await engine.layoutOf({...papers[0],fixedPages:{
  pageCount:2,answerMode:'inline',layout:stale
 }},new Map());
 assert.notEqual(revised,stale);
 assert.deepEqual(revised.questions,papers[0].questionIds);
 assert(revised.pages.flatMap(p=>p.questions).some(q=>q.id==='P31-017'&&q.height>100));
 console.log('Batch actual-image geometry regression passed: 2 students, 4 PDF pages, old layout repaired,',decoding,'image decodes');
}
verify().catch(error=>{console.error(error);process.exitCode=1;});
