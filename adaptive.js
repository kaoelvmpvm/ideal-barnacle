(function(global){
'use strict';
// Pure adaptive selection engine. No network and no student data leaves the browser.
const DAY=86400000;
function asDay(s){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(s||'')))return null;
 const t=Date.parse(s+'T12:00:00');
 return Number.isFinite(t)?t:null;
}
function paperDay(p){return String(p.trainingDate||p.date||'').slice(0,10);}
function weighted(items,fn){
 if(!items.length)return null;
 const weights=items.map(x=>Math.max(.001,Number(fn(x))||0));
 let ticket=Math.random()*weights.reduce((s,v)=>s+v,0);
 for(let i=0;i<items.length;i++){ticket-=weights[i];if(ticket<=0)return items[i];}
 return items[items.length-1];
}
function generate(opt){
 const count=Number(opt.count),topicCodes=[...new Set(opt.topics||[])],day=asDay(opt.trainingDate);
 if(!Number.isInteger(count)||count<1||!day)throw Error('題數或訓練日期不正確。');
 if(!topicCodes.length)throw Error('至少需要選擇一個考點。');
 const allowed=new Set(topicCodes),questions=(opt.questions||[]).filter(q=>allowed.has(q.primary_topic_code)&&opt.isUsable(q));
 if(questions.length<count)throw Error('所選考點可用題庫不足：候選 '+questions.length+' 題，需求 '+count+' 題。');
 const byId=new Map(questions.map(q=>[q.question_id,q]));
 const allPapers=opt.papers||[],allResults=opt.results||[],scope=opt.scope||'class';
 const papersById=new Map(allPapers.map(p=>[p.id,p]));
 const attempts=new Map(),assigned=new Map();
 const topics=new Map(topicCodes.map(code=>[code,{attempts:0,wrong:0,blank:0,conceptual:0,careless:0,unclassified:0,unique:new Set(),questionPool:0}]));
 questions.forEach(q=>topics.get(q.primary_topic_code).questionPool++);
 function attempt(id){if(!attempts.has(id))attempts.set(id,{n:0,wrong:0,blank:0,correct:0,lastAt:0,lastStatus:''});return attempts.get(id);}
 function isRelevantPaper(p){return scope==='class'?p.mode==='class':p.mode==='class'||p.student===scope;}
 allPapers.forEach(p=>{
   if(!isRelevantPaper(p))return;
   const d=asDay(paperDay(p));
   if(d===null||d>day)return;
   (p.questionIds||[]).forEach(id=>{
     const a=assigned.get(id)||0;
     assigned.set(id,Math.max(a,d));
   });
 });
 allResults.slice().sort((a,b)=>Date.parse(a.date||'')-Date.parse(b.date||'')).forEach(r=>{
   if(scope!=='class'&&r.student!==scope)return;
   const p=papersById.get(r.paperId);
   if(!p)return;
   const d=asDay(paperDay(p));
   if(d===null||d>day)return;
   const wrong=new Set(r.wrong||[]),blank=new Set(r.blank||[]);
   (p.questionIds||[]).forEach(id=>{
     const q=byId.get(id);if(!q)return;
     const a=attempt(id),t=topics.get(q.primary_topic_code);
     const state=wrong.has(id)?'wrong':blank.has(id)?'blank':'correct';
     a.n++;a[state]++;a.lastAt=d;a.lastStatus=state;
     t.attempts++;t.unique.add(id);
     if(state==='wrong'){
       t.wrong++;
       const reason=(r.reasons||{})[id]||'U';
       if(reason==='C')t.careless++;
       else if(reason==='K'||reason==='P')t.conceptual++;
       else t.unclassified++;
     }
     if(state==='blank')t.blank++;
   });
 });
 const used=new Set(),selected=[],selectedGroups=new Set(),distribution=Object.fromEntries(topicCodes.map(t=>[t,0]));
 const hasErrors=[...topics.values()].some(t=>t.wrong+t.blank>0);
 // Interleave complementary intents; empty intents fall back to general coverage.
 const intentions=[];
 let repairGoal=hasErrors?Math.max(1,Math.round(count*.4)):0;
 let exploreGoal=Math.min(count-repairGoal,Math.round(count*.4));
 let reviewGoal=count-repairGoal-exploreGoal;
 while(intentions.length<count){
   if(repairGoal-->0)intentions.push('repair');
   if(exploreGoal-->0)intentions.push('explore');
   if(reviewGoal-->0)intentions.push('review');
 }
 const blockedBeforeRelax=questions.filter(q=>{
   const a=attempts.get(q.question_id),last=assigned.get(q.question_id)||0;
   return (last&&day-last<7*DAY)||(a&&a.correct>0&&day-a.lastAt<14*DAY&&a.lastStatus==='correct');
 }).length;
 let reuses=0,relaxed=false;
 for(const intent of intentions){
   let candidates=questions.filter(q=>!used.has(q.question_id));
   // Explicit, teacher-provided similarity groups are respected where available.
   const safeGroup=q=>q.similarity_group||q.verified_similarity_group||'';
   let nonSiblings=candidates.filter(q=>!safeGroup(q)||!selectedGroups.has(safeGroup(q)));
   if(nonSiblings.length>=count-selected.length)candidates=nonSiblings;
   function eligible(q){
     const a=attempts.get(q.question_id),last=assigned.get(q.question_id)||0;
     return !(last&&day-last<7*DAY)&&!(a&&a.lastStatus==='correct'&&day-a.lastAt<14*DAY);
   }
   const freshPool=candidates.filter(eligible);
   // Hard protection while enough distinct nonrecent items remain for all unfilled slots.
   if(freshPool.length>=count-selected.length)candidates=freshPool;
   else {
     relaxed=true;
     // When scarce, use unseen questions first, then old mistakes, lastly recently correct ones.
     candidates=candidates.filter(q=>{
       const a=attempts.get(q.question_id),last=assigned.get(q.question_id)||0;
       return eligible(q)||!a||a.lastStatus!=='correct';
     });
     if(candidates.length<count-selected.length)candidates=questions.filter(q=>!used.has(q.question_id));
   }
   if(intent==='repair'){
     const weaker=candidates.filter(q=>{
       const z=topics.get(q.primary_topic_code);return z.wrong+z.blank>0;
     });
     if(weaker.length)candidates=weaker;
   }
   if(!candidates.length)throw Error('抽題數量不足，請減少題數或增加已選考點。');
   function topicScore(code){
     const t=topics.get(code),weightedLoss=t.conceptual+t.unclassified+.55*t.careless+.6*t.blank;
     const need=(weightedLoss+0.5)/(t.attempts+3);
     const coverage=1/Math.sqrt(1+t.unique.size);
     let s=intent==='repair'?(1+8*need):intent==='explore'?(1+4*coverage+1.2*need):(1+2*need+2*coverage);
     s/=1+distribution[code]*.9;
     return s;
   }
   const maxScore=Math.max(...candidates.map(q=>topicScore(q.primary_topic_code)));
   let groupCandidates=candidates.filter(q=>topicScore(q.primary_topic_code)>maxScore*.30);
   if(!groupCandidates.length)groupCandidates=candidates;
   const picked=weighted(groupCandidates,q=>{
     const a=attempts.get(q.question_id),last=assigned.get(q.question_id)||0;
     const lastDays=last?Math.max(0,(day-last)/DAY):999;
     let freshness=!a&&!last?4:!a?2.5:a.lastStatus==='wrong'?1.6:a.lastStatus==='blank'?1.4:1;
     if(last&&lastDays<7)freshness*=.08;
     if(a?.lastStatus==='correct'&&day-a.lastAt<14*DAY)freshness*=.04;
     if(a&&lastDays>=7)freshness*=1+Math.min(1,lastDays/30);
     return freshness*topicScore(q.primary_topic_code);
   });
   if(!picked)throw Error('無法完成抽題。');
   const id=picked.question_id,t=picked.primary_topic_code,a=attempts.get(id),recent=assigned.get(id)||0;
   if(recent&&day-recent<7*DAY)reuses++;
   used.add(id);selected.push({id,topic:t,intent:intent==='repair'&&topics.get(t).wrong+topics.get(t).blank===0?'explore':intent,seenBefore:!!a||!!recent,repeatWithin7Days:!!recent&&day-recent<7*DAY});
   distribution[t]++;
   const group=safeGroup(picked);if(group)selectedGroups.add(group);
 }
 const intentCounts={repair:0,explore:0,review:0};
 selected.forEach(x=>intentCounts[x.intent]++);
 const targetTopics=topicCodes.filter(c=>topics.get(c).wrong+topics.get(c).blank>0);
 return {ids:selected.map(x=>x.id),report:{
   engineVersion:'v9-adaptive',scope:scope,trainingDate:opt.trainingDate,
   topicDistribution:distribution,intentCounts:intentCounts,weakTopics:targetTopics,
   previouslyUnseen:selected.filter(x=>!x.seenBefore).length,
   previouslySeen:selected.filter(x=>x.seenBefore).length,
   recentRepeatCount:reuses,protectedCandidateCount:blockedBeforeRelax,
   relaxedProtection:relaxed,selectedReasons:selected.map(x=>({id:x.id,topic:x.topic,intent:x.intent})),
   note:'補弱僅依教師確認的八個理化單元，並非精細題型或理化概念的自動判斷。'}
 };
}
global.MathAnalyzeAdaptive={generate:generate,version:'v9-adaptive'};
})(window);