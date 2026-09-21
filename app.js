const STORE = 'everyone-review-plan-v1';
const today = dateOnly(new Date());
const initialState = {schemaVersion:1,planName:'我的复习计划',durations:{},proofs:{},completed:{},customTasks:[],restDays:{},advanceEvents:[],focusLogs:[],focusDrafts:{},focusTimer:null};
let state = loadState();
let selectedDate = today;
let progressDate = today;
let progressPeriod = 'day';
let durationEditing = null;
let customEditingId = null;
let catalogEditingId = null;
let taskOutlineDraft = [];
let catalogOutlineDraft = [];
let installPrompt = null;
let focusTask = null;
let focusInterval = null;

const icons = {
  custom:'<svg viewBox="0 0 24 24"><path d="M9 4h6l1 2h3v15H5V6h3Z"/><path d="m8 13 2.5 2.5L16 10"/></svg>',
  check:'<svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-8"/></svg>'
};
const chartColors = ['#6155f5','#34c759','#ff9f0a','#0088ff','#ff375f','#5ac8fa','#af52de','#8e8e93'];

function dateOnly(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function parseDate(key){const [y,m,d]=key.split('-').map(Number);return new Date(y,m-1,d);}
function addDays(key,amount){const date=parseDate(key);date.setDate(date.getDate()+amount);return dateOnly(date);}
function addMonths(key,amount){const date=parseDate(key);date.setDate(1);date.setMonth(date.getMonth()+amount);return dateOnly(date);}
function daysBetween(start,end){return Math.round((parseDate(end)-parseDate(start))/86400000);}
function formatDate(key,full=false){return new Intl.DateTimeFormat('zh-CN',full?{year:'numeric',month:'long',day:'numeric',weekday:'long'}:{month:'long',day:'numeric',weekday:'short'}).format(parseDate(key));}
function escapeText(value){const el=document.createElement('span');el.textContent=value;return el.innerHTML;}
function formatMinutes(value){const minutes=Math.round(value);if(minutes<60)return `${minutes} 分钟`;const hours=Math.floor(minutes/60),rest=minutes%60;return rest?`${hours} 小时 ${rest} 分钟`:`${hours} 小时`;}
function formatFocusSeconds(value){const seconds=Math.max(0,Math.round(value));return seconds<60?`${seconds} 秒`:formatMinutes(seconds/60);}
function cleanCatalog(value,fallback=[]){const items=(Array.isArray(value)?value:String(value||'').split(/\r?\n/)).map(item=>String(item).trim()).filter(Boolean);return items.length?items:[...fallback];}
function displayPlanName(){return String(state.planName||'我的复习计划').trim()||'我的复习计划';}
function updatePlanName(){const name=displayPlanName();document.querySelector('#brandName span').textContent=name;document.title=name;document.querySelector('meta[name="apple-mobile-web-app-title"]').content=name;}

function loadState(){
  try{
    const saved=JSON.parse(localStorage.getItem(STORE)||'{}');
    const merged={...initialState,...saved,planName:String(saved.planName||'我的复习计划').trim()||'我的复习计划',durations:saved.durations||{},proofs:saved.proofs||{},completed:saved.completed||{},restDays:saved.restDays||{},advanceEvents:Array.isArray(saved.advanceEvents)?saved.advanceEvents:[],focusLogs:Array.isArray(saved.focusLogs)?saved.focusLogs:[],focusDrafts:saved.focusDrafts||{},focusTimer:saved.focusTimer||null,customTasks:Array.isArray(saved.customTasks)?saved.customTasks.map(task=>({...task,category:task.category||'其他',outline:normalizeOutline(task.outline,task.catalog,task.totalDays),startDate:task.startDate||today,duration:Number(task.duration)||30})):[]};
    if(merged.focusTimer?.running){merged.focusTimer.elapsedSeconds=Math.min(merged.focusTimer.durationSeconds,(merged.focusTimer.elapsedSeconds||0)+Math.floor((Date.now()-merged.focusTimer.startedAt)/1000));merged.focusTimer.running=false;}
    return merged;
  }catch{return JSON.parse(JSON.stringify(initialState));}
}
function saveState(){localStorage.setItem(STORE,JSON.stringify(state));}

function makeId(){return `${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`;}
function normalizeOutline(outline,catalog=[],totalDays=1){
  if(Array.isArray(outline))return outline.map(root=>({id:root.id||makeId(),title:String(root.title||''),days:Math.max(1,Number(root.days)||1),children:Array.isArray(root.children)?root.children.map(child=>({id:child.id||makeId(),title:String(child.title||''),days:Math.max(1,Number(child.days)||1)})):[]}));
  const items=cleanCatalog(catalog);return items.map((title,index)=>({id:makeId(),title,days:Math.max(1,Math.floor((index+1)*totalDays/items.length)-Math.floor(index*totalDays/items.length)),children:[]}));
}
function outlineDays(outline){return outline.reduce((sum,root)=>sum+Math.max(1,Number(root.days)||1),0);}
function outlineItem(outline,index){
  let offset=0;
  for(const root of outline){const rootDays=Math.max(1,Number(root.days)||1);if(index<offset+rootDays){let childOffset=offset;for(const child of root.children||[]){const childDays=Math.max(1,Number(child.days)||1);if(index<childOffset+childDays)return {title:child.title,detail:`${root.title} · ${child.title} · 第 ${index-childOffset+1} / ${childDays} 天 · 完成后拍照`};childOffset+=childDays;}return {title:root.title,detail:`第 ${index-offset+1} / ${rootDays} 天 · 完成后拍照`};}offset+=rootDays;}
  return {title:'学习任务',detail:'完成后拍照'};
}
function seriesDefinitions(){
  return state.customTasks.map(task=>({id:`custom-${task.id}`,kind:'custom',category:task.category,startDate:task.startDate,totalDays:outlineDays(task.outline),defaultDuration:task.duration,itemAt:index=>outlineItem(task.outline,index)}));
}
function restCount(start,date){return Object.keys(state.restDays).filter(key=>state.restDays[key]&&key>=start&&key<=date).length;}
function advanceCount(seriesId,date){return state.advanceEvents.filter(event=>event.seriesId===seriesId&&event.targetDate<=date).length;}
function scheduledIndex(series,date){return daysBetween(series.startDate,date)-restCount(series.startDate,date)+advanceCount(series.id,date);}
function taskForSeries(series,date){
  if(date<series.startDate||state.restDays[date])return null;
  const index=scheduledIndex(series,date);if(index<0||index>=series.totalDays)return null;
  const item=series.itemAt(index);return {...series,...item,index,itemId:`${series.id}:${index}`,label:`${series.category} · ${index+1} / ${series.totalDays} 天`};
}
function taskData(date=selectedDate){return seriesDefinitions().map(series=>taskForSeries(series,date)).filter(Boolean);}
function durationFor(task){return state.durations[task.itemId]??task.defaultDuration??30;}
function completionFor(task){return state.completed[task.itemId];}
function completedEntries(){return Object.entries(state.completed).filter(([,entry])=>entry&&typeof entry==='object'&&entry.completedDate);}
function completedOnDate(date,scheduledTasks){
  const scheduledIds=new Set(scheduledTasks.map(task=>task.itemId)),seriesById=new Map(seriesDefinitions().map(series=>[series.id,series]));
  return completedEntries().filter(([itemId,entry])=>entry.completedDate===date&&entry.plannedDate!==date&&!scheduledIds.has(itemId)).map(([itemId,entry])=>{
    const series=seriesById.get(entry.seriesId),category=entry.category||series?.category||'其他';
    return {itemId,id:entry.seriesId,index:entry.index,kind:series?.kind||'custom',category,title:entry.title||'已完成任务',detail:`原计划 ${entry.plannedDate?formatDate(entry.plannedDate):'未来日期'} · 当天已打卡`,label:`${category} · 提前完成`,defaultDuration:entry.minutes||series?.defaultDuration||30};
  });
}

function renderDateStrip(){
  const wrap=document.querySelector('#dateStrip');wrap.innerHTML='';
  for(let i=-3;i<=3;i++){
    const key=addDays(selectedDate,i),date=parseDate(key),button=document.createElement('button');button.className='date-button'+(key===selectedDate?' selected':'');button.setAttribute('aria-label',formatDate(key,true));if(key===selectedDate)button.setAttribute('aria-current','date');
    button.innerHTML=`<span>${['日','一','二','三','四','五','六'][date.getDay()]}</span><strong>${date.getDate()}</strong>`;button.addEventListener('click',()=>{selectedDate=key;renderToday();});wrap.append(button);
  }
}
function renderToday(){
  document.querySelector('#fullDate').textContent=formatDate(selectedDate,true)+(selectedDate===today?' · 今天':'');document.querySelector('#todayTitle').textContent=state.restDays[selectedDate]?'今天，好好休息。':selectedDate===today?'今天，稳稳向前。':'这一天，也算数。';renderDateStrip();
  document.querySelector('#backToToday').hidden=selectedDate===today;
  const rest=document.querySelector('#restToday'),hasCompletedToday=completedEntries().some(([,entry])=>entry.plannedDate===today);
  rest.hidden=selectedDate!==today||(!state.restDays[today]&&hasCompletedToday);rest.classList.toggle('resting',Boolean(state.restDays[today]));rest.querySelector('strong').textContent=state.restDays[today]?'取消今天休息':'今天休息';rest.querySelector('small').textContent=state.restDays[today]?'恢复今天原有任务':'未完成任务将顺延一天';
  const tasks=taskData(),earlyCompleted=completedOnDate(selectedDate,tasks),list=document.querySelector('#taskList');list.innerHTML='';
  if(tasks.length)tasks.forEach(renderTask);
  if(earlyCompleted.length){const heading=document.createElement('div');heading.className='early-completed-heading';heading.textContent='当天提前完成';list.append(heading);earlyCompleted.forEach(renderTask);}
  if(!tasks.length&&!earlyCompleted.length)list.innerHTML=`<div class="custom-empty">${state.restDays[selectedDate]?'今天已设为休息日，任务已顺延。':'这一天还没有任务。可在“计划”中添加任务或调整开始日期。'}</div>`;
  const visibleTasks=[...tasks,...earlyCompleted],total=visibleTasks.reduce((sum,task)=>sum+durationFor(task),0),complete=visibleTasks.filter(completionFor).length,percent=visibleTasks.length?Math.round(complete/visibleTasks.length*100):0;
  document.querySelector('#totalDuration').textContent=visibleTasks.length?`共 ${total} 分钟`:'轻松一天';document.querySelector('#progressValue').textContent=`${percent}%`;document.querySelector('#progressRing').style.setProperty('--p',`${percent*3.6}deg`);
  document.querySelector('#progressMessage').textContent=state.restDays[selectedDate]?'休息也是计划的一部分。':!visibleTasks.length?'今天没有安排，留一点空间给自己。':complete===visibleTasks.length?'今日任务已完成。去好好休息吧。':complete?`已完成 ${complete} / ${visibleTasks.length} 项，继续保持。`:`完成今天的 ${visibleTasks.length} 项任务，就算赢下今天。`;
}
function renderTask(task){
  const node=document.querySelector('#taskTemplate').content.firstElementChild.cloneNode(true),proof=state.proofs[task.itemId],done=completionFor(task);node.classList.add(task.kind);if(done)node.classList.add('completed');node.querySelector('.subject-icon').innerHTML=icons[task.kind];node.querySelector('.subject-label').textContent=task.label;node.querySelector('h3').textContent=task.title;node.querySelector('.task-detail').textContent=task.detail;
  const duration=node.querySelector('.duration-pill');duration.textContent=`专注 ${durationFor(task)} 分钟`;duration.addEventListener('click',()=>openDuration(task));
  const focus=node.querySelector('.focus-button'),focused=focusSecondsForItem(task.itemId),isRunning=state.focusTimer?.itemId===task.itemId&&state.focusTimer.running;focus.classList.toggle('running',isRunning);focus.querySelector('strong').textContent=isRunning?'番茄钟进行中':'开始番茄专注';focus.querySelector('small').textContent=focused?`已专注 ${formatFocusSeconds(focused)}`:`本轮 ${durationFor(task)} 分钟`;focus.addEventListener('click',()=>openFocusTimer(task));
  const input=node.querySelector('.photo-input'),upload=node.querySelector('.upload-button'),replace=node.querySelector('.replace-proof'),preview=node.querySelector('.proof-preview'),complete=node.querySelector('.complete-button');
  if(proof){showProof(preview,upload,proof);complete.disabled=false;}complete.textContent=done?'已完成':selectedDate>today?'提前完成并记录专注':'完成打卡并记录专注';
  upload.addEventListener('click',()=>input.click());replace.addEventListener('click',()=>input.click());input.addEventListener('change',()=>handlePhoto(input.files[0],task));complete.addEventListener('click',()=>toggleComplete(task));document.querySelector('#taskList').append(node);
}
function focusSecondsForItem(itemId){return state.focusLogs.filter(log=>log.itemId===itemId).reduce((sum,log)=>sum+Number(log.seconds||0),0);}
function toggleComplete(task){
  const existing=completionFor(task);
  if(existing){delete state.completed[task.itemId];state.advanceEvents=state.advanceEvents.filter(event=>event.itemId!==task.itemId);}
  else{
    if(!state.proofs[task.itemId])return;
    state.completed[task.itemId]={completedDate:today,plannedDate:selectedDate,minutes:durationFor(task),category:task.category,title:task.title,seriesId:task.id,index:task.index};
    if(selectedDate>today&&!state.advanceEvents.some(event=>event.itemId===task.itemId))state.advanceEvents.push({seriesId:task.id,itemId:task.itemId,targetDate:selectedDate});
  }
  saveState();renderToday();
}
function showProof(preview,upload,proof){upload.hidden=true;preview.hidden=false;preview.querySelector('img').src=proof.data;preview.querySelector('.proof-name').textContent=proof.name;}
function handlePhoto(file,task){if(!file)return;const image=new Image(),reader=new FileReader();reader.onload=()=>{image.onload=()=>{const scale=Math.min(1,960/image.width),canvas=document.createElement('canvas');canvas.width=image.width*scale;canvas.height=image.height*scale;canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);state.proofs[task.itemId]={name:file.name,data:canvas.toDataURL('image/jpeg',.72)};saveState();renderToday();};image.src=reader.result;};reader.readAsDataURL(file);}

function openSheet(id){document.querySelector('#sheetBackdrop').hidden=false;document.querySelector(id).hidden=false;}
function closeSheets(){pauseFocusTimer();document.querySelector('#sheetBackdrop').hidden=true;document.querySelectorAll('.sheet').forEach(sheet=>sheet.hidden=true);durationEditing=null;customEditingId=null;catalogEditingId=null;}
function openDuration(task){durationEditing=task;document.querySelector('#durationSubject').textContent=`${task.category} · ${task.title}`;document.querySelector('#durationInput').value=durationFor(task);openSheet('#durationSheet');setTimeout(()=>document.querySelector('#durationInput').focus(),80);}

function currentFocusElapsed(){const timer=state.focusTimer;if(!timer)return 0;return Math.min(timer.durationSeconds,(timer.elapsedSeconds||0)+(timer.running?Math.floor((Date.now()-timer.startedAt)/1000):0));}
function pauseFocusTimer(){
  if(!state.focusTimer)return;state.focusTimer.elapsedSeconds=currentFocusElapsed();state.focusTimer.running=false;state.focusDrafts[state.focusTimer.itemId]=state.focusTimer.elapsedSeconds;clearInterval(focusInterval);focusInterval=null;saveState();
}
function openFocusTimer(task){
  if(state.focusTimer?.itemId!==task.itemId){pauseFocusTimer();state.focusTimer={itemId:task.itemId,durationSeconds:durationFor(task)*60,elapsedSeconds:state.focusDrafts[task.itemId]||0,running:false,startedAt:null};}
  focusTask=task;document.querySelector('#focusSubject').textContent=`${task.category} · ${task.title}`;openSheet('#focusSheet');startFocusTicker();renderFocusTimer();
}
function startFocusTicker(){clearInterval(focusInterval);focusInterval=setInterval(()=>{renderFocusTimer();if(state.focusTimer?.running&&currentFocusElapsed()>=state.focusTimer.durationSeconds)finishAndRecordFocus(true);},1000);}
function renderFocusTimer(){
  const timer=state.focusTimer;if(!timer)return;const elapsed=currentFocusElapsed(),remaining=Math.max(0,timer.durationSeconds-elapsed),minutes=Math.floor(remaining/60),seconds=remaining%60;document.querySelector('#timerValue').textContent=`${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;document.querySelector('#timerStatus').textContent=timer.running?'正在专注':elapsed?'已暂停':'准备专注';document.querySelector('#timerRing').style.setProperty('--timer-progress',`${elapsed/Math.max(timer.durationSeconds,1)*360}deg`);document.querySelector('#toggleFocus').textContent=timer.running?'暂停':'开始专注';document.querySelector('#finishFocus').disabled=elapsed<1;
}
function toggleFocusTimer(){
  const timer=state.focusTimer;if(!timer)return;if(timer.running)pauseFocusTimer();else{timer.startedAt=Date.now();timer.running=true;saveState();startFocusTicker();}renderFocusTimer();renderToday();
}
function resetFocusTimer(){if(!state.focusTimer)return;state.focusTimer.elapsedSeconds=0;state.focusTimer.running=false;state.focusTimer.startedAt=null;state.focusDrafts[state.focusTimer.itemId]=0;clearInterval(focusInterval);focusInterval=null;saveState();renderFocusTimer();renderToday();}
function finishAndRecordFocus(auto=false){
  if(!state.focusTimer||!focusTask)return;const seconds=currentFocusElapsed();if(seconds<1)return;const timer=state.focusTimer;state.focusLogs.push({id:`focus-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,itemId:focusTask.itemId,date:today,seconds,category:focusTask.category,title:focusTask.title});delete state.focusDrafts[timer.itemId];state.focusTimer=null;clearInterval(focusInterval);focusInterval=null;saveState();closeSheets();renderToday();if(document.querySelector('#progressView').classList.contains('active'))renderProgress();
}

function renderPlan(){
  const taskCount=state.customTasks.length,catalogCount=state.customTasks.reduce((sum,task)=>sum+task.outline.length+task.outline.reduce((count,root)=>count+(root.children||[]).length,0),0);
  document.querySelector('#planSummary').innerHTML=`<div class="summary-card"><strong>${taskCount} 个任务</strong><span>按自己的节奏安排</span></div><div class="summary-card"><strong>${catalogCount} 项目录</strong><span>可随时编辑</span></div>`;
  const list=document.querySelector('#planTaskList');list.innerHTML='';
  if(!taskCount)list.innerHTML='<div class="custom-empty">还没有任务。点击“添加任务”，从第一个学习单元开始。</div>';
  state.customTasks.forEach(task=>renderPlanGroup(list,task));
}
function renderPlanGroup(list,task){
  const group=document.createElement('section');group.className='plan-task-group';group.innerHTML=`<div class="plan-task-head"><div><h3>${escapeText(task.title)}</h3><p>${escapeText(task.category)} · ${formatDate(task.startDate)}开始 · ${outlineDays(task.outline)} 天 · ${task.outline.length} 项根目录</p></div><div class="plan-task-actions"><button class="task-meta-button" aria-label="编辑任务 ${escapeText(task.title)}">›</button><button class="catalog-edit-button">编辑目录</button></div></div><div class="plan-catalog"></div>`;
  const catalog=group.querySelector('.plan-catalog');task.outline.forEach((root,index)=>{const details=document.createElement('details');details.className='outline-plan-root';details.innerHTML=`<summary><span class="catalog-order">${String(index+1).padStart(2,'0')}</span><strong>${escapeText(root.title)}</strong><small>${root.days} 天 ${root.children.length?'· '+root.children.length+' 项子目录':''}</small><span aria-hidden="true">⌄</span></summary>`;root.children.forEach(child=>{const row=document.createElement('div');row.className='outline-plan-child';row.innerHTML=`<span>↳</span><strong>${escapeText(child.title)}</strong><small>${child.days} 天</small>`;details.append(row);});catalog.append(details);});
  group.querySelector('.catalog-edit-button').addEventListener('click',()=>openCatalogSheet(task.id,task.title));group.querySelector('.task-meta-button').addEventListener('click',()=>openTaskSheet(task.id));list.append(group);
}
function openTaskSheet(id=null){
  customEditingId=id;const task=state.customTasks.find(item=>item.id===id);document.querySelector('#taskSheetTitle').textContent=task?'编辑任务':'添加任务';document.querySelector('#customTitle').value=task?.title||'';document.querySelector('#customCategory').value=task?.category||'';document.querySelector('#customStartDate').value=task?.startDate||selectedDate;document.querySelector('#customDuration').value=task?.duration||30;taskOutlineDraft=structuredClone(task?.outline||[]);document.querySelector('#deleteTask').hidden=!task;document.querySelector('#taskError').hidden=true;renderOutlineEditor('task');openSheet('#taskSheet');setTimeout(()=>document.querySelector('#customTitle').focus(),80);
}
function openCatalogSheet(id,title){catalogEditingId=id;const task=state.customTasks.find(item=>item.id===id);catalogOutlineDraft=structuredClone(task?.outline||[]);document.querySelector('#catalogSubject').textContent=title;document.querySelector('#catalogError').hidden=true;renderOutlineEditor('catalog');openSheet('#catalogSheet');}

function outlineDraft(mode){return mode==='task'?taskOutlineDraft:catalogOutlineDraft;}
function renderOutlineEditor(mode){
  const draft=outlineDraft(mode),wrap=document.querySelector(mode==='task'?'#taskOutline':'#catalogOutline');wrap.innerHTML='';
  if(!draft.length)wrap.innerHTML='<p class="outline-empty">先添加一个根目录，例如“第一章”。</p>';
  draft.forEach((root,index)=>{
    const card=document.createElement('section');card.className='outline-root';card.dataset.root=index;
    card.innerHTML=`<div class="outline-root-row"><span class="outline-number">${String(index+1).padStart(2,'0')}</span><input class="outline-name" data-field="title" aria-label="根目录名称 ${index+1}" placeholder="根目录名称" value="${escapeText(root.title)}"><label class="outline-days"><input type="number" min="1" max="365" data-field="days" aria-label="根目录天数 ${index+1}" value="${root.days}">天</label></div><div class="outline-root-actions"><button type="button" data-action="add-child" aria-label="为 ${escapeText(root.title||'根目录')} 添加子目录">＋ 子目录</button><button type="button" data-action="move-up" ${index===0?'disabled':''} aria-label="根目录上移">↑</button><button type="button" data-action="move-down" ${index===draft.length-1?'disabled':''} aria-label="根目录下移">↓</button><button type="button" data-action="remove-root" class="outline-remove" aria-label="删除根目录">删除</button></div><div class="outline-children"></div><p class="outline-balance" hidden></p>`;
    const children=card.querySelector('.outline-children');root.children.forEach((child,childIndex)=>{const row=document.createElement('div');row.className='outline-child';row.dataset.child=childIndex;row.innerHTML=`<span>↳</span><input data-field="title" aria-label="子目录名称 ${childIndex+1}" placeholder="子目录名称" value="${escapeText(child.title)}"><label class="outline-days"><input type="number" min="1" max="365" data-field="days" aria-label="子目录天数 ${childIndex+1}" value="${child.days}">天</label><button type="button" data-action="remove-child" aria-label="删除子目录">×</button>`;children.append(row);});wrap.append(card);
  });
  updateOutlineTotals(mode);
}
function updateOutlineTotals(mode){
  const draft=outlineDraft(mode);if(mode==='task')document.querySelector('#taskTotalDays').textContent=`计划共 ${outlineDays(draft)} 天`;
  document.querySelectorAll(`${mode==='task'?'#taskOutline':'#catalogOutline'} .outline-root`).forEach((card,index)=>{const root=draft[index],sum=root.children.reduce((total,child)=>total+Number(child.days||0),0),label=card.querySelector('.outline-balance');label.hidden=!root.children.length;label.textContent=sum===Number(root.days)?`子目录共 ${sum} 天，与根目录一致`:`子目录共 ${sum} 天，根目录为 ${root.days} 天`;label.classList.toggle('invalid',root.children.length>0&&sum!==Number(root.days));});
}
function validateOutline(outline){
  if(!outline.length)return '请至少添加一个根目录。';
  if(outlineDays(outline)>365)return '单个任务最多安排 365 天。';
  for(const root of outline){if(!root.title.trim())return '请填写每个根目录的名称。';if(!Number.isInteger(Number(root.days))||Number(root.days)<1)return '根目录天数至少为 1 天。';if(root.children.length){if(root.children.some(child=>!child.title.trim()||!Number.isInteger(Number(child.days))||Number(child.days)<1))return '请填写每个子目录的名称和天数。';if(root.children.reduce((sum,child)=>sum+Number(child.days),0)!==Number(root.days))return `“${root.title}”的子目录天数之和需要等于根目录天数。`;}}
  return '';
}
function handleOutlineEdit(event,mode){
  const draft=outlineDraft(mode),card=event.target.closest('.outline-root'),rootIndex=Number(card?.dataset.root),childRow=event.target.closest('.outline-child'),childIndex=Number(childRow?.dataset.child);
  if(event.type==='input'&&event.target.matches('input[data-field]')){const node=childRow?draft[rootIndex].children[childIndex]:draft[rootIndex];node[event.target.dataset.field]=event.target.dataset.field==='days'?Number(event.target.value):event.target.value;updateOutlineTotals(mode);return;}
  const action=event.target.closest('button[data-action]')?.dataset.action;if(!action)return;
  if(action==='add-child'){const root=draft[rootIndex];root.children.push({id:makeId(),title:'',days:root.children.length?1:root.days});if(root.children.length>1)root.days=Number(root.days)+1;}
  if(action==='remove-child')draft[rootIndex].children.splice(childIndex,1);
  if(action==='remove-root')draft.splice(rootIndex,1);
  if(action==='move-up'&&rootIndex>0)[draft[rootIndex-1],draft[rootIndex]]=[draft[rootIndex],draft[rootIndex-1]];
  if(action==='move-down'&&rootIndex<draft.length-1)[draft[rootIndex+1],draft[rootIndex]]=[draft[rootIndex],draft[rootIndex+1]];
  renderOutlineEditor(mode);
}
for(const mode of ['task','catalog']){const wrap=document.querySelector(mode==='task'?'#taskOutline':'#catalogOutline');wrap.addEventListener('input',event=>handleOutlineEdit(event,mode));wrap.addEventListener('click',event=>handleOutlineEdit(event,mode));}
document.querySelector('#addTaskRoot').addEventListener('click',()=>{taskOutlineDraft.push({id:makeId(),title:'',days:1,children:[]});renderOutlineEditor('task');});
document.querySelector('#addCatalogRoot').addEventListener('click',()=>{catalogOutlineDraft.push({id:makeId(),title:'',days:1,children:[]});renderOutlineEditor('catalog');});

function periodRange(){
  if(progressPeriod==='day')return {start:progressDate,end:progressDate,label:formatDate(progressDate)};
  if(progressPeriod==='week'){const offset=(parseDate(progressDate).getDay()+6)%7,start=addDays(progressDate,-offset),end=addDays(start,6);return {start,end,label:`${formatDate(start)} — ${formatDate(end)}`};}
  const date=parseDate(progressDate),start=dateOnly(new Date(date.getFullYear(),date.getMonth(),1)),end=dateOnly(new Date(date.getFullYear(),date.getMonth()+1,0));return {start,end,label:`${date.getFullYear()}年${date.getMonth()+1}月`};
}
function renderProgress(){
  const range=periodRange(),logs=state.focusLogs.filter(log=>log.date>=range.start&&log.date<=range.end),completed=completedEntries().filter(([,entry])=>entry.completedDate>=range.start&&entry.completedDate<=range.end),byCategory={};logs.forEach(log=>{byCategory[log.category]=(byCategory[log.category]||0)+Number(log.seconds||0);});
  const groups=Object.entries(byCategory).sort((a,b)=>b[1]-a[1]),total=groups.reduce((sum,[,seconds])=>sum+seconds,0),days=new Set(logs.map(log=>log.date));document.querySelector('#progressDate').value=progressDate;document.querySelector('#focusRange').textContent=range.label;document.querySelector('#focusTotal').textContent=total<60?total:Math.round(total/60);document.querySelector('#focusPie span').textContent=total<60?'秒':'分钟';
  let angle=0;const stops=groups.map(([category,seconds],index)=>{const start=angle;angle+=seconds/Math.max(total,1)*100;return `${chartColors[index%chartColors.length]} ${start}% ${angle}%`;});document.querySelector('#focusPie').style.background=groups.length?`conic-gradient(${stops.join(',')})`:'conic-gradient(rgba(118,118,128,.12) 0 100%)';document.querySelector('#focusPie').setAttribute('aria-label',groups.length?groups.map(([category,seconds])=>`${category}${formatFocusSeconds(seconds)}`).join('，'):'暂无专注数据');
  const legend=document.querySelector('#focusLegend');legend.innerHTML='';groups.forEach(([category,seconds],index)=>{const percent=Math.round(seconds/total*100),button=document.createElement('button');button.className='legend-item';button.title=`${category}：${formatFocusSeconds(seconds)}，占 ${percent}%`;button.innerHTML=`<span class="legend-dot" style="background:${chartColors[index%chartColors.length]}"></span><strong>${escapeText(category)}</strong><span>${percent}%</span>`;const show=()=>document.querySelector('#pieDetail').textContent=`${category}：${formatFocusSeconds(seconds)} · ${percent}%`;button.addEventListener('mouseenter',show);button.addEventListener('focus',show);button.addEventListener('click',show);legend.append(button);});if(!groups.length)legend.innerHTML='<div class="custom-empty">暂无数据</div>';document.querySelector('#pieDetail').textContent=groups.length?'悬浮或点击分类，查看具体专注时间。':'完成一次番茄专注后，这里会按分类统计实际时长。';
  document.querySelector('#statsGrid').innerHTML=`<div class="stat-card"><strong>${formatFocusSeconds(total)}</strong><span>总专注时长</span></div><div class="stat-card"><strong>${completed.length}</strong><span>完成任务</span></div><div class="stat-card"><strong>${days.size}</strong><span>专注天数</span></div>`;
  const history=document.querySelector('#historyList');history.innerHTML='';const all=[...state.focusLogs].reverse();if(!all.length){history.innerHTML='<div class="empty-history">完成第一次番茄专注后，记录会出现在这里。</div>';return;}all.slice(0,20).forEach(log=>{const row=document.createElement('div');row.className='history-row';row.innerHTML=`<span class="history-dot">${icons.check}</span><div><strong>${escapeText(log.title)}</strong><span>${formatDate(log.date)} · ${escapeText(log.category)} · ${formatFocusSeconds(log.seconds)}</span></div>`;history.append(row);});
}

document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(item=>{item.classList.toggle('active',item===tab);item.removeAttribute('aria-current');});tab.setAttribute('aria-current','page');document.querySelectorAll('.view').forEach(view=>view.classList.toggle('active',view.id===tab.dataset.view));if(tab.dataset.view==='planView')renderPlan();if(tab.dataset.view==='progressView')renderProgress();window.scrollTo({top:0,behavior:'smooth'});}));
document.querySelector('#todayShortcut').addEventListener('click',()=>{selectedDate=today;document.querySelector('[data-view="todayView"]').click();renderToday();});
document.querySelector('#backToToday').addEventListener('click',()=>{selectedDate=today;renderToday();});
document.querySelector('#restToday').addEventListener('click',()=>{if(state.restDays[today])delete state.restDays[today];else state.restDays[today]=true;saveState();renderToday();});
document.querySelector('#openSettings').addEventListener('click',()=>{document.querySelector('#planName').value=displayPlanName();document.querySelector('#installHint').hidden=true;openSheet('#settingsSheet');});
document.querySelector('#openAddTask').addEventListener('click',()=>openTaskSheet());document.querySelectorAll('[data-close-sheet]').forEach(button=>button.addEventListener('click',closeSheets));document.querySelector('#sheetBackdrop').addEventListener('click',closeSheets);
document.querySelector('#presetRow').addEventListener('click',event=>{if(event.target.tagName==='BUTTON')document.querySelector('#durationInput').value=event.target.textContent;});
document.querySelector('#saveDuration').addEventListener('click',()=>{state.durations[durationEditing.itemId]=Math.max(5,Math.min(480,Number(document.querySelector('#durationInput').value)||30));if(state.focusTimer?.itemId===durationEditing.itemId&&!state.focusTimer.running)state.focusTimer.durationSeconds=state.durations[durationEditing.itemId]*60;saveState();closeSheets();renderToday();});
document.querySelector('#saveSettings').addEventListener('click',()=>{state.planName=document.querySelector('#planName').value.trim()||'我的复习计划';saveState();updatePlanName();closeSheets();renderToday();renderPlan();});
document.querySelector('#saveTask').addEventListener('click',()=>{const title=document.querySelector('#customTitle').value.trim(),category=document.querySelector('#customCategory').value.trim()||'其他',error=document.querySelector('#taskError'),problem=!title?'请输入任务名称。':validateOutline(taskOutlineDraft);if(problem){error.textContent=problem;error.hidden=false;return;}const task={id:customEditingId||makeId(),title,category,outline:structuredClone(taskOutlineDraft),startDate:document.querySelector('#customStartDate').value||selectedDate,duration:Math.max(5,Math.min(480,Number(document.querySelector('#customDuration').value)||30))},index=state.customTasks.findIndex(item=>item.id===customEditingId);if(index>=0)state.customTasks[index]=task;else state.customTasks.push(task);saveState();closeSheets();renderPlan();renderToday();});
document.querySelector('#saveCatalog').addEventListener('click',()=>{const problem=validateOutline(catalogOutlineDraft),error=document.querySelector('#catalogError');if(problem){error.textContent=problem;error.hidden=false;return;}const task=state.customTasks.find(item=>item.id===catalogEditingId);if(task)task.outline=structuredClone(catalogOutlineDraft);saveState();closeSheets();renderPlan();renderToday();});
document.querySelector('#deleteTask').addEventListener('click',()=>{const task=state.customTasks.find(item=>item.id===customEditingId);if(!task||!window.confirm(`删除“${task.title}”？`))return;const marker=`custom-${task.id}`;state.customTasks=state.customTasks.filter(item=>item.id!==task.id);state.advanceEvents=state.advanceEvents.filter(event=>event.seriesId!==marker);['durations','proofs','completed'].forEach(group=>Object.keys(state[group]).filter(key=>key.startsWith(`${marker}:`)).forEach(key=>delete state[group][key]));saveState();closeSheets();renderPlan();renderToday();});
document.querySelector('#periodTabs').addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;progressPeriod=button.dataset.period;document.querySelectorAll('#periodTabs button').forEach(item=>item.classList.toggle('active',item===button));renderProgress();});
document.querySelector('#progressDate').addEventListener('change',event=>{progressDate=event.target.value||today;renderProgress();});
document.querySelector('#progressPrev').addEventListener('click',()=>{progressDate=progressPeriod==='month'?addMonths(progressDate,-1):addDays(progressDate,progressPeriod==='week'?-7:-1);renderProgress();});
document.querySelector('#progressNext').addEventListener('click',()=>{progressDate=progressPeriod==='month'?addMonths(progressDate,1):addDays(progressDate,progressPeriod==='week'?7:1);renderProgress();});
document.querySelector('#closeFocus').addEventListener('click',closeSheets);document.querySelector('#toggleFocus').addEventListener('click',toggleFocusTimer);document.querySelector('#resetFocus').addEventListener('click',resetFocusTimer);document.querySelector('#finishFocus').addEventListener('click',()=>finishAndRecordFocus(false));
document.querySelector('#installApp').addEventListener('click',async()=>{const hint=document.querySelector('#installHint');if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;closeSheets();return;}hint.textContent=/iphone|ipad|ipod/i.test(navigator.userAgent)?'在 Safari 中点击“分享”，然后选择“添加到主屏幕”。':'在浏览器菜单中选择“安装应用”或“添加到主屏幕”。';hint.hidden=false;});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});document.addEventListener('keydown',event=>{if(event.key==='Escape')closeSheets();});if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./service-worker.js');updatePlanName();renderToday();
