(function(){
'use strict';
const API=window.MathAnalyzeExtensionAPI;
if(!API)return;
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const reasonNames={K:'知識不熟',P:'推理／方法錯',C:'已確認非知識性失誤',T:'時間不足',U:'未判定'};
let generating=false, initialized=false, selectedIds=new Set(), imageCache=new Map(), detailList=[];
 let preparedPdfUrl=null;
function toast(message,err){API.toast(message,!!err);}
function snapshot(){return API.snapshot();}
function selectedTopics(){return Array.from(document.querySelectorAll('#paperTopics input:checked')).map(x=>x.value);}
function bulkCandidates(){return snapshot().papers.filter(p=>p.mode==='individual'&&p.batchId);}
function batchGroups(){
 const groups=new Map();
 bulkCandidates().forEach(p=>{if(!groups.has(p.batchId))groups.set(p.batchId,[]);groups.get(p.batchId).push(p);});
 return [...groups.entries()].reverse();
}
function renderStudents(){
 const s=snapshot(),container=$('bulkStudentList');
 if(!container)return;
 const current=new Set(s.students);
 for(const id of [...selectedIds])if(!current.has(id))selectedIds.delete(id);
 if(!initialized&&s.students.length){selectedIds=new Set(s.students);initialized=true;}
 container.innerHTML=s.students.length?s.students.map(id=>'<label class="batch-student"><input type="checkbox" data-bulk-student="'+esc(id)+'" '+(selectedIds.has(id)?'checked':'')+'><span>'+esc(id)+'</span></label>').join(''):'<div class="notice warn">目前尚未建立學生代號。請先到「設定與備份」新增學生。</div>';
 $('bulkSelectedCount').textContent='已選 '+selectedIds.size+'／'+s.students.length+' 位';
 $('bulkDownload').disabled=generating||!selectedIds.size||!s.ready;
 $('bulkMergeExisting').disabled=generating||!selectedIds.size||!s.ready||!s.papers.some(p=>p.mode==='individual'&&selectedIds.has(p.student));
}
function renderBatches(){
 const box=$('bulkHistory');if(!box)return;
 const groups=batchGroups();
 box.innerHTML=groups.length?groups.slice(0,10).map(([id,papers])=>{
  let dt=papers[0]?.date||'';
  const counts=papers.map(p=>p.questionIds.length),lowest=Math.min(...counts),highest=Math.max(...counts);
  const countLabel=lowest===highest?lowest+'題／人':lowest+'～'+highest+'題／人';
  const allNew=papers.every(p=>p.fixedPages?.pageCount===2&&p.fixedPages?.answerMode==='inline');
  const pagesLabel=allNew?'2頁／人（含答案）':'舊版試卷（重印需符合雙頁限制）';
  return '<div class="batch-history-item"><span><strong>'+esc(papers[0].title.replace(/｜[^｜]+$/,''))+'</strong><small>'+esc(papers[0].trainingDate||dt.slice(0,10))+' · '+papers.length+' 位 · '+countLabel+' · '+pagesLabel+'</small></span><span class="actions"><button class="btn" data-bulk-redownload="'+esc(id)+'">下載合併PDF</button><button class="btn" data-bulk-answers="'+esc(id)+'">答案CSV</button></span></div>';
 }).join(''):'<p class="hint">尚無已建立的批次個別卷。按上方「批次產生並下載」即可開始。</p>';
}
function setBusy(on,message){
 generating=on;$('bulkDownload').disabled=on||!selectedIds.size||!snapshot().ready;
 $('bulkMergeExisting').disabled=on||!selectedIds.size||!snapshot().ready;
 if($('bulkProgress'))$('bulkProgress').textContent=message||'';
 document.querySelectorAll('[data-bulk-redownload]').forEach(btn=>btn.disabled=on);
}
function downloadBlob(blob,filename){
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function csv(rows,filename){
 const body='\ufeff'+rows.map(row=>row.map(value=>{
  let s=String(value==null?'':value);
  if(/^[=+\-@\t\r]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
 }).join(',')).join('\r\n');
 downloadBlob(new Blob([body],{type:'text/csv;charset=utf-8'}),filename);
}
function answerRows(papers){
 const rows=[['學生代號','試卷名稱','題號','題庫編號','教師分類','原題庫答案']];
 papers.forEach(p=>p.questionIds.forEach((id,i)=>{
   const q=API.question(id)||{};
   rows.push([p.student,p.title,i+1,id,q.teacher_category_label||q.primary_topic||'分類待核對',q.answer_as_provided||'待核對']);
 }));
 return rows;
}
function batchAnswers(papers){csv(answerRows(papers),'MathAnalyze_個別卷答案_'+papers.length+'人_'+new Date().toISOString().slice(0,10)+'.csv');}
function headerPng(p,continued){
 const c=document.createElement('canvas');
 c.width=1500;c.height=215;const ctx=c.getContext('2d');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,1500,215);ctx.fillStyle='#152d47';
 ctx.font='bold 51px "Microsoft JhengHei","Noto Sans TC",sans-serif';
 ctx.fillText((p.title||'理化個別卷').slice(0,31),22,67,1440);
 ctx.font='34px "Microsoft JhengHei","Noto Sans TC",sans-serif';
 ctx.fillText('訓練日期：'+(p.trainingDate||String(p.date||'').slice(0,10))+'    學生代號：'+p.student+'    時間：'+p.minutes+'分鐘    題數：'+p.questionIds.length+'題'+(continued?'    （續頁）':''),22,127,1440);
 ctx.strokeStyle='#92a5b8';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(22,165);ctx.lineTo(1470,165);ctx.stroke();
 return c.toDataURL('image/png');
}
async function asJpeg(blob){
 const bitmap=await createImageBitmap(blob);
 const canvas=document.createElement('canvas');let width=bitmap.width;
 const factor=Math.min(1,1600/width);
 canvas.width=Math.max(1,Math.round(width*factor));canvas.height=Math.max(1,Math.round(bitmap.height*factor));
 const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
 const data=canvas.toDataURL('image/jpeg',0.91);
 bitmap.close();canvas.width=1;canvas.height=1;
 return {data:data,width:Math.round(width*factor),height:Math.round(bitmap.height*factor)};
}
async function getJpeg(id){
 if(imageCache.has(id))return imageCache.get(id);
 const b=await API.imageBlob(id);if(!b)throw Error('題目 '+id+' 圖片不存在，請先重新匯入 v1 題圖包。');
 const result=await asJpeg(b);imageCache.set(id,result);return result;
}
function clearPreparedPdf(){
  const link=$('bulkPdfReady');
  if(link){link.style.display='none';link.removeAttribute('href');link.removeAttribute('download');}
  if(preparedPdfUrl){URL.revokeObjectURL(preparedPdfUrl);preparedPdfUrl=null;}
 }
 function offerPdfDownload(pdf,filename){
  const blob=pdf.output('blob');
  if(!(blob instanceof Blob)||blob.size<1000)throw Error('產生的 PDF 檔案異常，未提供下載。');
  const link=$('bulkPdfReady');
  if(!link)throw Error('找不到 PDF 下載連結，請重新整理網頁。');
  preparedPdfUrl=URL.createObjectURL(blob);
  link.href=preparedPdfUrl;link.download=filename;link.style.display='inline-flex';
  link.textContent='點此下載合併 PDF（若未自動下載）';
  // Asynchronous image processing may lose browser user activation for automatic downloads.
  // Retain a visible link so the teacher can download with an explicit click.
  try{link.click();}catch(error){/* Manual link remains available for user activation. */}
  return {bytes:blob.size,pages:pdf.internal.getNumberOfPages()};
 }
 
const BATCH_PAGES=2;
const INLINE_OPTIONS={maxPages:BATCH_PAGES,exactPages:true,answerMode:'inline'};
async function getDimensions(id,cache){
 // The catalog's image_width/image_height can differ from the actual WebP.
 // Measure the decoded source, then apply exactly the same JPEG downscaling
 // and integer rounding as asJpeg(), so pagination matches PDF rendering.
 if(cache.has(id))return cache.get(id);
 const blob=await API.imageBlob(id);
 if(!blob)throw Error('題目 '+id+' 的原始題圖不存在，請重新匯入題庫 ZIP。');
 if(typeof createImageBitmap!=='function')throw Error('此瀏覽器不支援題圖尺寸解碼，請使用最新版 Edge 或 Chrome。');
 const bitmap=await createImageBitmap(blob);
 let width,height;
 try{
  const scale=Math.min(1,1600/bitmap.width);
  width=Math.max(1,Math.round(bitmap.width*scale));
  height=Math.max(1,Math.round(bitmap.height*scale));
 }finally{bitmap.close();}
 if(!(width>0&&height>0))throw Error('題目 '+id+' 的實際圖片尺寸無效。');
 const size={width,height};
 cache.set(id,size);
 return size;
}
async function prepareBatchPlans(students,maxQuestions,trainingDate,topics){
 const core=window.PhysicsFixedCore;
 if(!core)throw Error('兩頁排版模組未載入，請重新整理。');
 const overall=API.usableQuestionCount(topics);
 if(overall<4)throw Error('所選單元可用題數少於4題，無法批次產生個別卷。');
 const limits=topics.map(code=>({code,count:API.usableQuestionCount([code])})).filter(x=>x.count);
 const sizeCache=new Map(),signatures=new Set(),plans=[];
 for(let i=0;i<students.length;i++){
  const student=students[i];
  let result=null,signature='';
  for(let attempt=0;attempt<8;attempt++){
   const poolCount=Math.min(overall,Math.max(30,maxQuestions*3),45);
   const main=API.planQuestions(poolCount,topics,student,trainingDate).ids;
   const pool=[...main];
   for(const item of limits){
    const extra=API.planQuestions(Math.min(item.count,8),[item.code],student,trainingDate).ids;
    pool.push(...extra);
   }
   const candidates=[...new Set(pool)],sizes={},valid=[];
   for(const id of candidates){
    try{sizes[id]=await getDimensions(id,sizeCache);valid.push(id);}
    catch(error){/* An unreadable candidate is never selected or stored. */}
   }
   if(!valid.length)throw Error('學生 '+student+' 所選考點沒有可以完整排版的題圖。');
   result=core.choose([],valid,sizes,{...INLINE_OPTIONS,maxQuestions,minQuestions:1});
   if(result.layout.pageCount!==2||result.layout.answerMode!=='inline')throw Error('學生 '+student+' 無法符合固定兩頁規格。');
   signature=result.ids.slice().sort().join('|');
   if(!signatures.has(signature))break;
  }
  if(signatures.has(signature))throw Error('學生 '+student+' 與同批其他學生的完整題目重複；請增加單元範圍或降低預設題數後重試。');
  signatures.add(signature);
  plans.push({student,questionIds:result.ids,layout:result.layout});
  setBusy(true,'正在排版學生 '+(i+1)+'／'+students.length+'（'+student+'）：'+result.ids.length+'題／固定2頁……');
  if(i%2===1)await new Promise(resolve=>setTimeout(resolve,0));
 }
 return plans;
}
function answerPng(p,answerHeight){
 const width=1600,ratio=width/186,c=document.createElement('canvas');
 c.width=width;c.height=Math.round(answerHeight*ratio);
 const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
 ctx.strokeStyle='#aabbd0';ctx.lineWidth=3;ctx.strokeRect(2,2,c.width-4,c.height-4);
 ctx.fillStyle='#16334f';ctx.font='bold 38px "Microsoft JhengHei","Noto Sans TC",sans-serif';
 ctx.fillText('教師用答案（依原題庫標記，請覆核）',23,66);
 ctx.font='23px "Microsoft JhengHei","Noto Sans TC",sans-serif';
 ctx.fillText('提醒：本頁含答案，請勿直接發給學生。',23,102);
 const step=9*ratio,colWidth=width/6;
 for(let i=0;i<p.questionIds.length;i++){
  const q=API.question(p.questionIds[i])||{},value=String(q.answer_as_provided||'?').toUpperCase();
  ctx.fillStyle='#263c53';ctx.font='bold 37px Arial,"Microsoft JhengHei",sans-serif';
  ctx.fillText((i+1)+'. '+value,20+(i%6)*colWidth,133+Math.floor(i/6)*step,colWidth-25);
 }
 const png=c.toDataURL('image/png');c.width=c.height=1;return png;
}
function storedLayoutIsSafe(layout,p,sizes,core){
 if(!layout||layout.pageCount!==BATCH_PAGES||layout.answerMode!=='inline'||
    !Array.isArray(layout.pages)||layout.pages.length!==BATCH_PAGES||
    layout.pages[0].answer||!layout.pages[1].answer||
    !Array.isArray(layout.questions)||layout.questions.join('|')!==p.questionIds.join('|'))return false;
 const answer=layout.pages[1].answer;
 if(Math.abs(answer.height-core.answerHeight(p.questionIds.length))>0.01||
    answer.y+answer.height>core.PAGE.bottom+0.01)return false;
 let seen=0;
 for(let page=0;page<BATCH_PAGES;page++){
  const sheet=layout.pages[page],maxY=page===1?answer.y-8:core.PAGE.bottom;
  if(!Array.isArray(sheet.questions))return false;
  let lower=core.PAGE.top;
  for(const item of sheet.questions){
   const size=sizes[item.id];
   if(!size||item.id!==p.questionIds[seen]||item.number!==seen+1||
      !Number.isFinite(item.y)||!Number.isFinite(item.height))return false;
   const actual=core.PAGE.imageWidth*size.height/size.width;
   // Exact decoded-image dimensions are used at PDF output, not catalog metadata.
   if(Math.abs(actual-item.height)>0.05||
      item.y<lower-0.01||item.y+actual>maxY+0.01)return false;
   lower=item.y+actual+core.PAGE.gap;
   seen++;
  }
 }
 return seen===p.questionIds.length;
}
async function layoutOf(p,sizeCache){
 const core=window.PhysicsFixedCore;
 if(!core)throw Error('固定兩頁排版模組未載入。');
 // Always inspect the actual WebP dimensions. Old saved layouts may have
 // been calculated from inaccurate catalog metadata.
 const sizes={};
 for(const id of p.questionIds)sizes[id]=await getDimensions(id,sizeCache);
 const stored=p.fixedPages?.layout;
 if(storedLayoutIsSafe(stored,p,sizes,core))return stored;
 // Reflow the FULL saved set without removing, reordering or renumbering.
 const layout=core.layout(p.questionIds,sizes,{...INLINE_OPTIONS,preserveOrder:true});
 if(!layout||layout.questions.join('|')!==p.questionIds.join('|'))
  throw Error('既有試卷「'+p.title+'」依實際題圖尺寸無法完整排入2頁。原題目與紀錄已保留；請重新「批次產生並合併下載 PDF」以自動調整題數。');
 return layout;
}
async function combinedPdf(papers){
 clearPreparedPdf();
 if(!papers.length)throw Error('未選擇任何個別卷。');
 if(!snapshot().ready)throw Error('請先匯入 v1 題圖包，才能合併下載。');
 const JSPDF=window.jspdf?.jsPDF;
 if(!JSPDF)throw Error('PDF 組件未載入，請檢查網路連線並重新整理。');
 const pdf=new JSPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
 const core=window.PhysicsFixedCore;
 if(!core)throw Error('兩頁排版模組未載入，請重新整理。');
 const sizeCache=new Map();let total=0,started=false;
 imageCache=new Map();
 try{
  for(let k=0;k<papers.length;k++){
   const p=papers[k],layout=await layoutOf(p,sizeCache);
   if(layout.pageCount!==BATCH_PAGES||layout.pages.length!==BATCH_PAGES||
      layout.answerMode!=='inline'||!layout.pages[1].answer||
      layout.questions.join('|')!==p.questionIds.join('|'))
    throw Error('學生 '+p.student+' 的雙頁試卷結構不正確，停止合併。');
   for(let page=0;page<BATCH_PAGES;page++){
    if(started)pdf.addPage();
    started=true;
    const sheet=layout.pages[page];
    pdf.addImage(headerPng(p,page===1),'PNG',14,12,182,26);
    for(const item of sheet.questions){
     const asset=await getJpeg(item.id);
     const h=core.PAGE.imageWidth*asset.height/asset.width;
     if(!Number.isFinite(h)||Math.abs(h-item.height)>1)
      throw Error('學生 '+p.student+' 的題目 '+item.id+' 圖片尺寸變動，停止輸出以防超頁。');
     if(item.y+item.height>core.PAGE.bottom+0.01)throw Error('題目 '+item.id+' 超過列印安全範圍。');
     pdf.setFont('helvetica','normal');pdf.setFontSize(11);pdf.setTextColor(35,48,67);
     pdf.text(String(item.number)+'.',14,item.y+6);
     pdf.addImage(asset.data,'JPEG',core.PAGE.imageX,item.y,core.PAGE.imageWidth,item.height,'q_'+item.id,'FAST');
     total++;
    }
    if(sheet.answer){
     if(page!==1||sheet.answer.y+sheet.answer.height>core.PAGE.bottom+0.01)
      throw Error('學生 '+p.student+' 的答案區塊超出第二頁。');
     pdf.addImage(answerPng(p,sheet.answer.height),'PNG',12,sheet.answer.y,186,sheet.answer.height);
    }
   }
   setBusy(true,'正在合併 '+(k+1)+'／'+papers.length+' 位，已加入 '+total+' 題……');
   if(k%2===1)await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(pdf.internal.getNumberOfPages()!==papers.length*BATCH_PAGES)
   throw Error('合併頁數不正確，應為每位學生恰好2頁。');
  const file='PhysicsAnalyze_個別卷合併_固定雙頁_'+papers.length+'人_'+new Date().toISOString().slice(0,10)+'.pdf';
  setBusy(true,'雙頁PDF已排版完成，正在準備下載……');
  const summary=offerPdfDownload(pdf,file);
  setBusy(true,'已建立 '+summary.pages+' 頁合併 PDF（'+(summary.bytes/1024/1024).toFixed(1)+' MB，每人2頁含答案）。如未自動下載，請點擊下載連結。');
  toast('合併 PDF 已建立：'+papers.length+'位學生，每人2頁含答案，共'+total+'題。');
 }finally{imageCache.clear();}
}
async function runBatch(){
 if(generating)return;
 const s=snapshot(),ids=s.students.filter(id=>selectedIds.has(id));
 if(!ids.length)return toast('請先選擇學生。',true);
 if(!s.ready)return toast('請先在設定與備份匯入 v1 題圖包。',true);
 const count=Number($('paperCount').value),minutes=Number($('paperMinutes').value),trainingDate=$('paperDate').value,topics=selectedTopics();
 if(!topics.length)return toast('至少選擇一個考點。',true);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(trainingDate))return toast('請選擇訓練日期。',true);
 if(ids.length*count>700&&!confirm('此次共 '+ids.length*count+' 題，合併 PDF 可能需要較長時間及記憶體。仍要繼續嗎？'))return;
 setBusy(true,'正在為 '+ids.length+' 位學生選題……');
 try{
  const plans=await prepareBatchPlans(ids,count,trainingDate,topics);
   const papers=API.createBatch({students:ids,count,minutes,trainingDate,topics,title:$('paperTitle').value,plans});
  renderBatches();
  await combinedPdf(papers);
 }catch(err){toast('批次處理未完成：'+err.message,true);setBusy(true,'操作遇到問題：'+err.message+'。如已產生試卷，可在下方「歷次批次」重新下載。');}
 finally{setBusy(false,$('bulkProgress').textContent);}
}

async function mergeExisting(){
 if(generating)return;
 const s=snapshot(),ids=s.students.filter(id=>selectedIds.has(id));
 const latest=ids.map(id=>s.papers.filter(p=>p.mode==='individual'&&p.student===id).at(-1)).filter(Boolean);
 const missing=ids.filter(id=>!latest.some(p=>p.student===id));
 if(!latest.length)return toast('選取的學生尚未產生個別試卷。',true);
 if(missing.length&&!confirm('有 '+missing.length+' 位學生沒有已建立的個別卷（'+missing.slice(0,5).join('、')+(missing.length>5?'…':'')+'），只合併其餘 '+latest.length+' 位，確定嗎？'))return;
 if(latest.length>1&&new Set(latest.map(p=>p.minutes+'-'+(p.trainingDate||String(p.date||'').slice(0,10))+'-'+p.questionIds.length)).size>1){
 if(!confirm('這些學生最新試卷的訓練日期、題數或考試時間不完全相同，仍要合併嗎？'))return;
 }
 setBusy(true,'正在合併 '+latest.length+' 份既有個別卷……');
 try{await combinedPdf(latest);}catch(err){toast('合併失敗：'+err.message,true);setBusy(true,'合併失敗：'+err.message);}finally{setBusy(false,$('bulkProgress')?.textContent||'');}
}

function studentData(student){
 const s=snapshot(),papers=new Map(s.papers.map(p=>[p.id,p]));
 const rec=s.results.filter(r=>r.student===student&&papers.has(r.paperId)).sort((a,b)=>new Date(b.date)-new Date(a.date));
 const topics=new Map(s.topics.map(t=>[t[0],{name:t[1],count:0,correct:0,wrong:0,blank:0,dates:new Set()}]));
 const errors=[],times=new Map(),unique=new Set();
 let total=0,correct=0,wrong=0,blank=0,minutes=0;
 rec.forEach(r=>{
  const p=papers.get(r.paperId);
  const wrongSet=new Set(r.wrong||[]),blankSet=new Set(r.blank||[]);
  minutes+=Number(r.minutes)||0;
  p.questionIds.forEach((id,index)=>{
   const q=API.question(id)||{},topic=topics.get(q.primary_topic_code);
   const status=wrongSet.has(id)?'wrong':blankSet.has(id)?'blank':'correct';
   if(topic){topic.count++;topic.dates.add(String(r.date||'').slice(0,10));}
   total++;
   if(status==='correct'){correct++;if(topic)topic.correct++;return;}
   if(status==='wrong'){wrong++;if(topic)topic.wrong++;}
   else{blank++;if(topic)topic.blank++;}
   times.set(id,(times.get(id)||0)+1);unique.add(id);
   errors.push({id,order:index+1,status,topic:q.teacher_category_label||q.primary_topic||'待核對',reason:r.reasons?.[id]||'U',paper:p.title,date:p.trainingDate||String(r.date||'').slice(0,10)});
  });
 });
 return {rec,topics,errors,times,unique,total,correct,wrong,blank,minutes};
}
function individualReport(){
 const box=$('studentWrongDetail');if(!box)return;
 const student=$('reportScope').value||'class';
 if(student==='class'){box.innerHTML='<p class="notice">請先在上方「學習分析」的下拉選單選擇某位學生，即可查看該學生的實際錯題、未作答紀錄與重複失分考點。</p>';return;}
 const data=studentData(student),topics=[...data.topics.entries()].map(([code,z])=>({code,...z})).sort((a,b)=>b.wrong+b.blank-(a.wrong+a.blank));
 const topicRows=topics.map(z=>{
  const errors=z.wrong+z.blank;
  const ratio=z.count?(100*(z.count-errors)/z.count).toFixed(0)+'%':'—';
  const tag=!z.count?'未測':errors>=2&&z.dates.size>=2?'跨回失分':errors?'須回刷':'本次未失分';
  return '<tr><td>'+esc(z.name)+'</td><td class="num">'+z.count+'</td><td class="num">'+z.wrong+'</td><td class="num">'+z.blank+'</td><td class="num">'+ratio+'</td><td><span class="chip '+(errors?'wait':'ok')+'">'+tag+'</span></td></tr>';
 }).join('');
 const errors=data.errors.map((e,i)=>{
  return '<tr><td>'+esc(e.date)+'</td><td title="'+esc(e.paper)+'">'+esc(e.paper.length>26?e.paper.slice(0,25)+'…':e.paper)+'</td><td>'+e.order+'</td><td>'+esc(e.id)+'</td><td>'+esc(e.topic)+'</td><td><span class="chip '+(e.status==='wrong'?'bad':'wait')+'">'+(e.status==='wrong'?'答錯':'未作答')+'</span></td><td>'+esc(reasonNames[e.reason]||'未判定')+'</td><td><button class="btn" data-show-wrong="'+esc(e.id)+'">看原題</button></td></tr>';
 }).join('');
 detailList=data.errors;
 const repeated=[...data.times.entries()].filter(([id,n])=>n>=2);
 box.innerHTML='<div class="actions" style="justify-content:space-between"><div><h3 class="section-title">個別錯題明細｜'+esc(student)+'</h3><p class="hint">只使用這位學生已登記的真實作答紀錄；「未作答」與「答錯」分開計算。</p></div><button class="btn" id="downloadStudentWrong" '+(data.errors.length?'':'disabled')+'>匯出個別錯題CSV</button></div>'+
 '<div class="grid grid-4" style="margin:14px 0">'+stat('累積作答',data.total+'題',data.rec.length+'回測驗')+stat('答錯',data.wrong+'題','不含未作答')+stat('未作答',data.blank+'題','獨立計算')+stat('相同原題再次失分',repeated.length+'題','按穩定題庫編號')+'</div>'+
 '<h4>八項考點的失分分布</h4><div class="table-scroll"><table><thead><tr><th>教師確認分類</th><th class="num">作答</th><th class="num">答錯</th><th class="num">未作答</th><th class="num">正確率</th><th>標記</th></tr></thead><tbody>'+topicRows+'</tbody></table></div>'+
 '<h4 style="margin-top:20px">逐題紀錄（最新在前）</h4>'+
 (data.errors.length?'<div class="table-scroll"><table><thead><tr><th>日期</th><th>試卷</th><th>題號</th><th>來源ID</th><th>考點</th><th>狀態</th><th>錯因</th><th></th></tr></thead><tbody>'+errors+'</tbody></table></div>':'<p class="notice">目前沒有已登記的答錯或未作答題目；若尚未測驗，不能視為全部考點均已熟練。</p>')+
 '<p class="hint">「跨回失分」代表該考點累積失分至少2次且出現在不同日期的測驗中；不等同重複答錯同一原題。錯因須由教師標記，未填者維持未判定。</p>';
 const dl=$('downloadStudentWrong');if(dl)dl.onclick=()=>csv([['學生代號','日期','試卷','題號','來源題庫編號','教師確認考點','作答狀態','錯誤原因']].concat(data.errors.map(e=>[student,e.date,e.paper,e.order,e.id,e.topic,e.status==='wrong'?'答錯':'未作答',reasonNames[e.reason]||'未判定'])),'MathAnalyze_個別錯題_'+student+'.csv');
}
function stat(title,value,detail){return '<div class="card kpi"><div class="k">'+esc(title)+'</div><div class="num">'+esc(value)+'</div><div class="foot">'+esc(detail)+'</div></div>';}
async function openWrong(id){
 const q=API.question(id),b=await API.imageBlob(id);
 if(!b)return toast('找不到 '+id+' 的題圖；請重新匯入 v1 題庫。',true);
 const dlg=$('wrongDialog');const url=URL.createObjectURL(b);
 dlg.querySelector('.wrong-preview-title').textContent=id+'｜'+(q?.teacher_category_label||q?.primary_topic||'');
 const img=dlg.querySelector('img');img.src=url;img.onload=()=>URL.revokeObjectURL(url);
 if(typeof dlg.showModal==='function')dlg.showModal();else{dlg.setAttribute('open','');}
}
function refresh(){renderStudents();renderBatches();individualReport();}
function init(){
  window.addEventListener('pagehide',clearPreparedPdf);
 $('bulkSelectAll').onclick=()=>{selectedIds=new Set(snapshot().students);renderStudents();};
 $('bulkSelectNone').onclick=()=>{selectedIds.clear();initialized=true;renderStudents();};
 $('bulkStudentList').addEventListener('change',e=>{const id=e.target.dataset.bulkStudent;if(!id)return;if(e.target.checked)selectedIds.add(id);else selectedIds.delete(id);initialized=true;renderStudents();});
 $('bulkDownload').onclick=runBatch;
 $('bulkMergeExisting').onclick=mergeExisting;
 $('bulkHistory').addEventListener('click',async e=>{
  const dl=e.target.closest('[data-bulk-redownload]'),ans=e.target.closest('[data-bulk-answers]');
  const id=dl?.dataset.bulkRedownload||ans?.dataset.bulkAnswers;if(!id)return;
  const papers=snapshot().papers.filter(p=>p.batchId===id).sort((a,b)=>a.student.localeCompare(b.student,'zh-Hant'));
  if(ans){batchAnswers(papers);return;}if(generating)return;
  setBusy(true,'正在合併既有批次 '+papers.length+' 份試卷……');
  try{await combinedPdf(papers);}catch(err){toast('下載失敗：'+err.message,true);setBusy(true,'下載失敗：'+err.message);}finally{setBusy(false,$('bulkProgress')?.textContent||'');}
 });
 $('studentWrongDetail').addEventListener('click',e=>{const btn=e.target.closest('[data-show-wrong]');if(btn)openWrong(btn.dataset.showWrong);});
 $('wrongDialogClose').onclick=()=>$('wrongDialog').close?.();
 refresh();
}
window.MathAnalyzeExtensions={refresh:refresh,studentData:studentData,answerRows:answerRows};
init();
})();