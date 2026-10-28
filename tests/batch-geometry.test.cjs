'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('../fixed-pages-core.js');
const source=fs.readFileSync(path.join(__dirname,'../features.js'),'utf8');
const get=(first,last)=>{
 const a=source.indexOf(first),b=source.indexOf(last,a);
 assert(a>=0&&b>a,'Cannot extract '+first);
 return source.slice(a,b);
};
// Exercise the REAL browser conversion functions, not a fake getJpeg().
// Earlier tests mocked getJpeg(), missing the ImageBitmap.close() bug.
const converter=get('function imagePixelSize(','function clearPreparedPdf(){');
const composer=get('const BATCH_PAGES=2;','async function runBatch(){');

async function verify(){
 const students=['815-01','815-02','815-03'];
 const items={};
 for(let person=0;person<students.length;person++){
  for(let i=0;i<32;i++){
   const id=person===0&&i===0?'P31-024':person===1&&i===0?'P31-017':'q'+person+'-'+i;
   items[id]={
    image_width:900,image_height:90, // deliberately incorrect catalog
    actualWidth:id==='q0-1'?3200:900,
    actualHeight:id==='P31-024'?570:id==='P31-017'?380:id==='q0-1'?1050:i%6===0?310:100,
    answer_as_provided:'A'
   };
  }
 }
 const API={
  question:id=>items[id],
  imageBlob:async id=>items[id]?{id}:null,
  usableQuestionCount:()=>32,
  planQuestions:(n,topics,student)=>({ids:Array.from({length:n},(_,i)=>
   i===0&&student==='815-01'?'P31-024':
   i===0&&student==='815-02'?'P31-017':
   'q'+students.indexOf(student)+'-'+i)})
 };
 let decodes=0,closes=0;
 const createImageBitmap=async blob=>{
  const data=items[blob.id];
  if(!data)throw Error('No test image '+blob.id);
  decodes++;
  return {
   width:data.actualWidth,height:data.actualHeight,
   close(){
    closes++;
    // Real ImageBitmap.close() detaches its dimensions.
    this.width=0;this.height=0;
   }
  };
 };
 const drawn=[];let pdf;
 class PDF{
  constructor(){this.pageCount=1;pdf=this;this.internal={getNumberOfPages:()=>this.pageCount};}
  addPage(){this.pageCount++;}
  addImage(data,format,x,y,w,h){drawn.push({page:this.pageCount,format,x,y,w,h});}
  setFont(){}setFontSize(){}setTextColor(){}text(){}
 }
 const ctx={
  fillRect(){},strokeRect(){},fillText(){},
  drawImage(source,x,y,w,h){
   assert(source.width>0&&source.height>0&&w>0&&h>0,
    'The converter must draw BEFORE ImageBitmap.close()');
  }
 };
 const document={createElement:()=>({
  width:1,height:1,getContext:()=>ctx,
  toDataURL:type=>type==='image/jpeg'?'data:image/jpeg;base64,AA==':'data:image/png;base64,AA=='
 })};
 let downloads=0;
 const createEngine=new Function(
  'API','window','createImageBitmap','document','headerPng',
  'clearPreparedPdf','snapshot','setBusy','offerPdfDownload','toast','setTimeout',
  'URL','Image','Blob',
  'let imageCache=new Map();\n'+converter+'\n'+composer+
  '\nreturn {getJpeg,getDimensions,prepareBatchPlans,layoutOf,combinedPdf};'
 );
 const engine=createEngine(
  API,{PhysicsFixedCore:core,jspdf:{jsPDF:PDF}},createImageBitmap,document,
  ()=>'header',()=>{},()=>({ready:true}),()=>{},
  ()=>{downloads++;return {bytes:2048,pages:pdf.pageCount};},
  ()=>{},callback=>callback(),{},null,Object
 );
 // Reproduce P31-024 and assert returned dimensions are kept after close().
 const encoded=await engine.getJpeg('P31-024');
 assert.equal(encoded.width,900);
 assert.equal(encoded.height,570,'JPEG height must not become zero after image close()');
 const shrunk=await engine.getJpeg('q0-1');
 assert.deepEqual([shrunk.width,shrunk.height],[1600,525],'Oversized image must use encoded pixel dimensions');
 const actual=await engine.getDimensions('P31-017',new Map());
 assert.deepEqual(actual,{width:900,height:380},'Do not trust catalog metadata');

 const plans=await engine.prepareBatchPlans(students,16,'2026-10-28',['U']);
 assert.equal(plans.length,3);
 for(const plan of plans){
  assert.equal(plan.layout.pageCount,2);
  assert.equal(plan.layout.answerMode,'inline');
  assert.deepEqual(plan.layout.questions,plan.questionIds);
  assert(plan.layout.pages[1].answer);
 }
 assert(plans[0].questionIds.includes('P31-024'),'Known problematic question must remain printable');
 assert(plans[1].questionIds.includes('P31-017'));
 const papers=plans.map(p=>({
  student:p.student,questionIds:p.questionIds,title:p.student,minutes:25,
  trainingDate:'2026-10-28',
  fixedPages:{pageCount:2,answerMode:'inline',layout:p.layout}
 }));
 await engine.combinedPdf(papers);
 assert.equal(pdf.pageCount,students.length*2);
 assert.deepEqual(drawn.filter(x=>x.format==='PNG'&&x.x===12).map(x=>x.page),[2,4,6]);
 assert.equal(drawn.filter(x=>x.format==='JPEG').length,
  papers.reduce((sum,p)=>sum+p.questionIds.length,0));
 assert.equal(downloads,1);

 // Existing batches with wrong image metadata must be reflowed, not truncated.
 const oldSizes=Object.fromEntries(plans[0].questionIds.map(id=>[id,{width:900,height:90}]));
 const stale=core.layout(plans[0].questionIds,oldSizes,{
  maxPages:2,exactPages:true,answerMode:'inline',preserveOrder:true
 });
 assert(stale,'Old metadata should produce a stale layout in this regression');
 const revised=await engine.layoutOf({...papers[0],fixedPages:{
  pageCount:2,answerMode:'inline',layout:stale
 }},new Map());
 assert.notEqual(revised,stale);
 assert.deepEqual(revised.questions,papers[0].questionIds);
 assert(revised.pages.flatMap(p=>p.questions).some(q=>q.id==='P31-024'&&q.height>100));

 // Impossible old batches must fail explicitly, without dropping answer items.
 const tooLarge=Object.fromEntries(['x','y','z'].map(id=>[id,{width:900,height:900}]));
 assert.equal(core.layout(['x','y','z'],tooLarge,{
  maxPages:2,exactPages:true,answerMode:'inline',preserveOrder:true
 }),null);
 // Browser fallback without createImageBitmap must also keep exact pixels.
 let revoked=0,created=0;
 class HTMLImage{
  constructor(){this.naturalWidth=900;this.naturalHeight=420;this.width=900;this.height=420;}
  set src(value){if(this.onload)this.onload();}
 }
 const fallback=new Function('API','createImageBitmap','document','URL','Image','Blob',
  'let imageCache=new Map();\n'+converter+'\nreturn {getJpeg,getDimensions:undefined};')(
  {imageBlob:async()=>({id:'fallback'})},undefined,document,
  {createObjectURL:()=>{created++;return 'blob:fallback';},revokeObjectURL:()=>{revoked++;}},
  HTMLImage,Object
 );
 const fallbackJpeg=await fallback.getJpeg('fallback');
 assert.deepEqual([fallbackJpeg.width,fallbackJpeg.height],[900,420]);
 assert.equal(created,1);assert.equal(revoked,1);
 assert.equal(closes,decodes,'Every decoded bitmap must be closed');
 console.log('Batch geometry tests passed: 3 students, 6 PDF pages, P31-024 and P31-017, downsizing, stale-layout recovery, bitmap lifecycle');
}
verify().catch(error=>{console.error(error);process.exitCode=1;});
