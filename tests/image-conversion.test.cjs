'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../fixed-pages.js'),'utf8');
const take=(begin,end)=>{
 const a=source.indexOf(begin),b=source.indexOf(end,a);
 assert(a>=0&&b>a,'Missing '+begin);
 return source.slice(a,b);
};
const pixel=take('function pdfImagePixels(','let busy=false;');
const measure=take('async function dimensions(ids){','function candidates(o){');
const convert=take('async function toJpeg(blob){','function headerImage(');
async function run(){
 const blobs={normal:{w:947,h:380},large:{w:3600,h:1113}};
 const API={imageBlob:async id=>blobs[id]?{id}:null};
 let closed=0;
 const createImageBitmap=async blob=>({
  width:blobs[blob.id].w,height:blobs[blob.id].h,
  close(){closed++;this.width=0;this.height=0;}
 });
 const ctx={fillRect(){},drawImage(source,x,y,w,h){
  assert(source.width>0&&source.height>0,'Source closed before rendering');
  assert(w>0&&h>0);
 }};
 const document={createElement:()=>({
  width:1,height:1,getContext:()=>ctx,
  toDataURL:()=> 'data:image/jpeg;base64,AA=='
 })};
 const helpers=new Function('API','createImageBitmap','document','message','pause','URL','Image',
  pixel+'\n'+measure+'\n'+convert+'\nreturn {dimensions,toJpeg};'
 )(API,createImageBitmap,document,()=>{},()=>Promise.resolve(),{},null);
 const geometry=await helpers.dimensions(['normal','large']);
 assert.deepEqual(geometry.normal,{width:947,height:380});
 assert.deepEqual(geometry.large,{width:1800,height:557});
 for(const id of ['normal','large']){
  const jpg=await helpers.toJpeg(await API.imageBlob(id));
  assert.deepEqual({width:jpg.width,height:jpg.height},geometry[id],
    'Measured and encoded pixels must be exactly equal');
 }
 assert.equal(closed,4);
 console.log('Single-sheet JPEG geometry tests passed: source closes reset width and height; measured and printed dimensions agree');
}
run().catch(err=>{console.error(err);process.exitCode=1;});
