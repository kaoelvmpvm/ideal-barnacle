/* Fixed-page composition for Physics Analyze. Questions/images remain in the teacher's browser. */
(function(){
 'use strict';
 const API=window.MathAnalyzeExtensionAPI,Core=window.PhysicsFixedCore;
 if(!API||!Core)return;
 const $=id=>document.getElementById(id);
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const nowDate=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);};
 let busy=false;
 function message(s,bad){const box=$('fixedStatus');if(!box)return;box.className='notice'+(bad?' warn':'');box.textContent=s;box.setAttribute('role','status');}
 function selected(){return Array.from(document.querySelectorAll('[data-fixed-topic]:checked')).map(el=>el.value);}
 function fillTopics(){
  const box=$('fixedTopics');if(!box)return;
  const current=new Map(Array.from(box.querySelectorAll('[data-fixed-topic]')).map(el=>[el.value,el.checked]));
  const minima=new Map(Array.from(box.querySelectorAll('[data-fixed-min]')).map(el=>[el.dataset.fixedMin,el.value]));
  const exact=$('fixedQuotaMode')?.value==='exact';
  box.innerHTML=API.snapshot().topics.map(([code,name,unit])=>
   '<div class="fixed-topic-row"><label><input type="checkbox" data-fixed-topic value="'+escape(code)+'" '+(current.has(code)?current.get(code)?'checked':'':'checked')+'> '+escape(unit)+' '+escape(name)+'</label><label class="fixed-min-label"><span class="fixed-quota-word">'+(exact?'恰好':'至少')+'</span> <input class="control" type="number" min="0" max="45" step="1" value="'+escape(minima.get(code)??0)+'" data-fixed-min="'+escape(code)+'" aria-label="'+escape(unit)+'最低題數"> 題</label></div>'
  ).join('');
 }
 function fillStudents(){
  const el=$('fixedStudent');if(!el)return;
  const old=el.value;
  const students=API.snapshot().students;
  el.innerHTML='<option value="">請選學生</option>'+students.map(s=>'<option value="'+escape(s)+'">'+escape(s)+'</option>').join('');
  if(students.includes(old))el.value=old;
  el.disabled=$('fixedMode').value!=='individual';
 }
 function refresh(){fillStudents();}
 function checkDate(v){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(new Date(v+'T12:00:00').getTime()))throw Error('請指定有效的訓練日期。');
 }
 function read(){
  if(!API.snapshot().ready)throw Error('請先在「設定與備份」匯入508題的理化題圖包。');
  const maxPages=Number($('fixedPageLimit').value),minutes=Number($('fixedMinutes').value);
  let maxQuestions=Number($('fixedQuestionCount').value),minQuestions=Number($('fixedMinTotal').value);
  const quotaMode=$('fixedQuotaMode').value;
  const answerMode=$('fixedAnswerMode').value,mode=$('fixedMode').value,student=$('fixedStudent').value;
  const trainingDate=$('fixedDate').value;let topics=selected();
  const title=$('fixedTitle').value.trim()||trainingDate+' 理化固定頁數練習卷';
  checkDate(trainingDate);
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>10)throw Error('頁數上限為1～10頁。');
  if(answerMode==='separate'&&maxPages<2)throw Error('答案獨立最後一頁時，至少須設定2頁。');
  if(!Number.isInteger(maxQuestions)||maxQuestions<1||maxQuestions>45)throw Error('期望題數為1～45題。');
  if(!Number.isInteger(minQuestions)||minQuestions<0||minQuestions>maxQuestions)throw Error('至少題數應為0～期望題數。');
  if(!topics.length)throw Error('請至少勾選一個單元。');
  if(mode==='individual'&&!student)throw Error('請先在設定中建立學生，並選擇指定學生。');
  const minimums={};
  for(const el of document.querySelectorAll('[data-fixed-min]')){
   const x=Number(el.value),code=el.dataset.fixedMin;
   if(!Number.isInteger(x)||x<0||x>45)throw Error('各單元的最低題數必須是0～45的整數。');
   if(x&&!topics.includes(code))throw Error('單元 '+code+' 已取消勾選，請先將該單元最低題數設為0。');
   if(topics.includes(code))minimums[code]=x;
  }
  const requiredTotal=Object.values(minimums).reduce((a,b)=>a+b,0);
  if(quotaMode==='exact'){
   if(requiredTotal<1)throw Error('精確配題需要至少填寫一個單元的題數。');
   if(requiredTotal>45)throw Error('精確配題最多45題。');
   topics=topics.filter(code=>minimums[code]>0);
   maxQuestions=requiredTotal;minQuestions=requiredTotal;
  }else if(requiredTotal>maxQuestions){
   throw Error('各單元最低題數合計 '+requiredTotal+' 題，超過期望題數 '+maxQuestions+' 題。');
  }
  return {maxPages,maxQuestions,minQuestions,answerMode,minutes,mode,student,trainingDate,title,topics,minimums,
   scope:mode==='individual'?student:'class',quotaMode};
 }
 async function pause(){return new Promise(resolve=>setTimeout(resolve,0));}
 async function dimensions(ids){
  const sizes={},pending=[];
  for(const id of ids){
   const q=API.question(id);
   if(!q)continue;
   const w=Number(q.image_width),h=Number(q.image_height);
   if(w>0&&h>0)sizes[id]={width:w,height:h};
   else pending.push(id);
  }
  // Older teacher packages may lack image dimensions in catalog.json.
  // Read the original WebP dimensions in memory; never estimate an unknown geometry.
  for(let i=0;i<pending.length;i++){
   const id=pending[i],blob=await API.imageBlob(id);
   if(!blob)continue;
   let w=0,h=0;
   if(typeof createImageBitmap==='function'){
    const im=await createImageBitmap(blob);w=im.width;h=im.height;im.close();
   }else{
    const result=await new Promise((resolve,reject)=>{
     const im=new Image(),url=URL.createObjectURL(blob);
     im.onload=()=>{const dims={w:im.naturalWidth,h:im.naturalHeight};URL.revokeObjectURL(url);resolve(dims);};
     im.onerror=()=>{URL.revokeObjectURL(url);reject(Error('無法讀取題圖 '+id));};
     im.src=url;
    });
    w=result.w;h=result.h;
   }
   if(w>0&&h>0)sizes[id]={width:w,height:h};
   if((i+1)%12===0){message('正在測量題圖尺寸 '+(i+1)+'／'+pending.length+'……');await pause();}
  }
  return sizes;
 }
 function candidates(o){
  const required=[],all=new Set();
  const countOf=code=>API.usableQuestionCount([code]);
  for(const code of o.topics){
   const n=o.minimums[code]||0;
   if(!n)continue;
   const available=countOf(code);
   if(n>available)throw Error(code+' 可用題只有 '+available+' 題，無法達到最低 '+n+' 題。');
   const ids=API.planQuestions(n,[code],o.scope,o.trainingDate).ids;
   required.push(...ids);
  }
  const nAvailable=API.usableQuestionCount(o.topics);
  if(nAvailable===0)throw Error('選取單元沒有可用題目，請檢查題庫。');
  const poolSize=Math.min(nAvailable,Math.max(o.maxQuestions*4,80));
  const plan=API.planQuestions(poolSize,o.topics,o.scope,o.trainingDate);
  plan.ids.forEach(id=>all.add(id));
  // Supplement short-form candidates within individual chapters, so dense diagrams
  // do not crowd out unrelated short questions when a strict page cap is requested.
  for(const code of o.topics){
   const size=Math.min(countOf(code),Math.max(10,(o.minimums[code]||0)+6));
   if(size)API.planQuestions(size,[code],o.scope,o.trainingDate).ids.forEach(id=>all.add(id));
  }
  return {required,pool:[...all],available:nAvailable};
 }
 async function toJpeg(blob){
  let source;
  if(typeof createImageBitmap==='function')source=await createImageBitmap(blob);
  else source=await new Promise((resolve,reject)=>{const img=new Image(),url=URL.createObjectURL(blob);img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('題圖解碼失敗'));};img.src=url;});
  const width=source.width,height=source.height;
  const scale=Math.min(1,1800/width);
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));
  canvas.height=Math.max(1,Math.round(height*scale));
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('瀏覽器無法繪製題目圖片。');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(source,0,0,canvas.width,canvas.height);
  const data=canvas.toDataURL('image/jpeg',0.94);
  if(source.close)source.close();
  canvas.width=1;canvas.height=1;
  return {data,width,height};
 }
 function headerImage(o,page,total,count,isAnswer){
  const c=document.createElement('canvas');c.width=1500;c.height=240;
  const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
  ctx.fillStyle='#16334f';ctx.font='bold 47px "Microsoft JhengHei","Noto Sans TC",sans-serif';
  ctx.fillText(o.title.slice(0,32),14,62,1450);
  ctx.fillStyle='#3f5369';ctx.font='30px "Microsoft JhengHei","Noto Sans TC",sans-serif';
  ctx.fillText('日期：'+o.trainingDate+'　座號：＿＿＿　姓名：＿＿＿＿　時間：'+o.minutes+' 分鐘　題數：'+count,14,123,1460);
  ctx.fillText((isAnswer?'教師答案頁　':'')+'第 '+page+'／'+total+' 頁（答案包含在頁數上限內）',14,180);
  ctx.strokeStyle='#b5c5d8';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(14,220);ctx.lineTo(1470,220);ctx.stroke();
  return c.toDataURL('image/png');
 }
 function answerImage(ids,height,separate){
  const width=1600,pxPerMm=width/186,c=document.createElement('canvas');
  c.width=width;c.height=Math.round(height*pxPerMm);
  const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
  ctx.strokeStyle='#aabbd0';ctx.lineWidth=3;ctx.strokeRect(2,2,width-4,c.height-4);
  ctx.fillStyle='#16334f';ctx.font='bold 38px "Microsoft JhengHei","Noto Sans TC",sans-serif';
  ctx.fillText('教師用答案（依原始題庫標記，請覆核）',23,66);
  if(!separate){ctx.font='23px "Microsoft JhengHei","Noto Sans TC",sans-serif';ctx.fillText('注意：答案與試題印在同一頁，請勿直接發給學生。',23,102);}
  const top=separate?130:133,step=9*pxPerMm,columns=6,columnWidth=width/columns;
  for(let i=0;i<ids.length;i++){
   const id=ids[i],q=API.question(id)||{},ans=String(q.answer_as_provided||'?').toUpperCase();
   const col=i%columns,row=Math.floor(i/columns);
   ctx.fillStyle='#263c53';ctx.font='bold 37px Arial,"Microsoft JhengHei",sans-serif';
   ctx.fillText((i+1)+'. '+ans,20+col*columnWidth,top+row*step,columnWidth-25);
  }
  const png=c.toDataURL('image/png');c.width=c.height=1;return png;
 }
 async function buildPdf(o,layout,ids){
  const PDF=window.jspdf?.jsPDF;if(!PDF)throw Error('PDF 模組尚未載入，請檢查網路後重新整理。');
  if(layout.pageCount>o.maxPages)throw Error('排版超過指定頁數，已中止輸出。');
  if(layout.questions.join('|')!==ids.join('|'))throw Error('題目排列與版面資訊不一致，請重新產生。');
  if(layout.pages.length!==layout.pageCount||!layout.pages.at(-1).answer)throw Error('答案頁排版資料不完整。');
  const pdf=new PDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
  const count=ids.length;
  for(let pageIdx=0;pageIdx<layout.pages.length;pageIdx++){
   const p=layout.pages[pageIdx];if(pageIdx>0)pdf.addPage();
   pdf.addImage(headerImage(o,pageIdx+1,layout.pageCount,count,!p.questions.length),'PNG',12,9,186,29);
   for(const item of p.questions){
    const blob=await API.imageBlob(item.id);
    if(!blob)throw Error('題目 '+item.id+' 的題圖不存在。請重新匯入題庫 ZIP。');
    const img=await toJpeg(blob);
    const trueHeight=Core.PAGE.imageWidth*img.height/img.width;
    if(Math.abs(trueHeight-item.height)>1)throw Error('題目 '+item.id+' 題圖尺寸已改變，無法保證頁數，請重新產生。');
    if(item.y+item.height>Core.PAGE.bottom+0.1)throw Error('題目超出紙張安全範圍，已中止。');
    pdf.setTextColor(35,48,67);pdf.setFont('helvetica','normal');pdf.setFontSize(11);
    pdf.text(String(item.number)+'.',14,item.y+6);
    pdf.addImage(img.data,'JPEG',Core.PAGE.imageX,item.y,Core.PAGE.imageWidth,item.height,undefined,'FAST');
   }
   if(p.answer)pdf.addImage(answerImage(ids,p.answer.height,o.answerMode==='separate'),'PNG',12,p.answer.y,186,p.answer.height);
   if(pageIdx%2===1){message('正在產生PDF：'+(pageIdx+1)+'／'+layout.pageCount+'頁……');await pause();}
  }
  if(pdf.internal.getNumberOfPages()!==layout.pageCount||pdf.internal.getNumberOfPages()>o.maxPages)
   throw Error('實際PDF頁數與限制不一致，已中止下載。');
  return pdf.output('blob');
 }
 function download(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),12000);
 }
 async function generate(){
  if(busy)return;busy=true;$('fixedCreate').disabled=true;
  try{
   const o=read();
   message('正在依各單元最低題數與歷次失分紀錄選題……');
   await pause();
   const {required,pool,available}=candidates(o),all=[...new Set([...required,...pool])];
   const dims=await dimensions(all);
   const badRequired=required.find(id=>!dims[id]);if(badRequired)throw Error('指定最低題數中的題目 '+badRequired+' 缺少圖像尺寸，無法安全排版。');
   const clean=pool.filter(id=>!!dims[id]);
   let result;
   try{result=Core.choose(required,clean,dims,o);}
   catch(error){
    // If a first adaptive selection is too long for the page cap, try shorter
    // intact questions from the same requested units before reporting conflict.
    if(!required.length||!/最低題數無法/.test(String(error.message)))throw error;
    const compact=[];
    for(const code of o.topics){
     const need=o.minimums[code]||0;
     if(!need)continue;
     const alternatives=clean.filter(id=>API.question(id)?.primary_topic_code===code)
      .sort((a,b)=>(dims[a].height/dims[a].width)-(dims[b].height/dims[b].width));
     if(alternatives.length<need)throw Error('單元 '+code+' 的完整候選題不足，無法滿足指定題數。');
     compact.push(...alternatives.slice(0,need));
    }
    try{result=Core.choose(compact,clean,dims,o);}
    catch(second){throw Error('已嘗試替換為同單元較短的完整題目，仍無法在指定頁數內容納必要題數。請增加頁數或減少指定題數。');}
   }
   message('已成功排入 '+result.ids.length+' 題、'+result.layout.pageCount+' 頁（含答案），正在逐張驗證並生成PDF……');
   const pdf=await buildPdf(o,result.layout,result.ids);
   download(pdf,'PhysicsAnalyze_'+o.trainingDate+'_固定'+o.maxPages+'頁_'+result.ids.length+'題.pdf');
   API.storeFixedPaper({title:o.title,trainingDate:o.trainingDate,minutes:o.minutes,mode:o.mode,student:o.student,
    questionIds:result.ids,fixedPages:{maxPages:o.maxPages,answerMode:o.answerMode,pageCount:result.layout.pageCount,layout:result.layout}});
   message('完成：'+result.ids.length+' 題、實際 '+result.layout.pageCount+'／上限 '+o.maxPages+' 頁（答案已包含）。'+
    (result.ids.length<o.maxQuestions?'因版面限制，未達期望 '+o.maxQuestions+' 題；較長的題圖已自動略過。':'已達期望題數。')+
    ' 已儲存試卷，可至「智能出卷」重印，或於「錯題登記」使用。');
   API.toast('已下載固定頁數PDF：'+result.layout.pageCount+'頁／'+result.ids.length+'題。');
  }catch(err){message('無法出卷：'+err.message,true);API.toast(err.message,true);}
  finally{busy=false;$('fixedCreate').disabled=false;}
 }
 async function downloadExisting(p){
  if(busy)throw Error('目前正在產生另一份試卷。');
  if(!API.snapshot().ready)throw Error('請重新匯入理化題庫 ZIP，才能重印試卷。');
  if(!p||!p.fixedPages)throw Error('不是固定頁數考卷。');
  const fixed=p.fixedPages,layout=fixed.layout;
  if(!layout||!Array.isArray(layout.pages)||layout.questions.join('|')!==p.questionIds.join('|'))
   throw Error('此卷的原始固定版面資料遺失，為避免版面改變，請重新配題。');
  const o={title:p.title,trainingDate:p.trainingDate||String(p.date||'').slice(0,10),
   minutes:p.minutes,maxPages:fixed.maxPages,answerMode:fixed.answerMode};
  busy=true;
  try{
   const blob=await buildPdf(o,layout,p.questionIds);
   download(blob,'PhysicsAnalyze_'+o.trainingDate+'_重印固定'+o.maxPages+'頁.pdf');
   API.toast('已重印原版固定頁數考卷。');
  }catch(err){API.toast('重印失敗：'+err.message,true);}
  finally{busy=false;}
 }
 function init(){
  if(!$('fixedCreate'))return;
  fillTopics();fillStudents();$('fixedDate').value=nowDate();
  $('fixedMode').onchange=fillStudents;
  $('fixedTopics').addEventListener('change',event=>{
   if(event.target.matches('[data-fixed-topic]')){
    const row=event.target.closest('.fixed-topic-row'),input=row.querySelector('[data-fixed-min]');
    if(!event.target.checked)input.value=0;
   }
  });
  $('fixedQuotaMode').onchange=()=>{
   const exact=$('fixedQuotaMode').value==='exact';
   $('fixedQuestionCount').disabled=exact;$('fixedMinTotal').disabled=exact;
   document.querySelectorAll('.fixed-quota-word').forEach(el=>el.textContent=exact?'恰好':'至少');
  };
  $('fixedCreate').onclick=generate;
  message('設定頁數、題數與單元；系統會保留完整題圖，最後一頁包含答案。');
 }
 window.PhysicsFixedPages={refresh,downloadExisting,core:Core};
 init();
})();
