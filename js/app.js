import {loadState,saveState,makeDefaultState,downloadBackup} from "./storage.js";

let state=loadState();
let selectedDate=todayKey();
let weekOffset=0;
let planDraft=null;
let intervalDraft=[10,10];
let pendingExerciseRemoval=null;

const $=id=>document.getElementById(id);
const sections=["warmup","strength","cardio","flexibility"];
const labels={warmup:"Warm up",strength:"Strength",cardio:"Cardio",flexibility:"Flexibility"};
function planById(id){return state.plans.find(x=>x.id===id)}

function localDateKey(d=new Date()){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return `${y}-${m}-${day}`}
function todayKey(){return localDateKey(new Date())}
function keyFromDate(d){return localDateKey(d)}
function prettyDate(key){return new Intl.DateTimeFormat("en-US",{weekday:"long",month:"long",day:"numeric"}).format(new Date(key+"T12:00:00"))}
function exById(id){return state.exercises.find(x=>x.id===id)}
function activeExercises(category){return state.exercises.filter(x=>!x.archived&&(!category||x.category===category))}
function itemCategory(item){return item.category||exById(item.exerciseId)?.category||"strength"}
function isDone(item){return item.type==="cardio"?(item.intervals?.length>0&&item.intervals.every(x=>x.done)):(item.sets?.length>0&&item.sets.every(x=>x.done))}
function persist(){saveState(state);renderAll()}
function workoutFor(key,create=false){if(!state.workouts[key]&&create){state.workouts[key]={date:key,planIds:[],items:[]};saveState(state)}return state.workouts[key]}
function normalizeName(s){return s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g,"")}
function similarName(name,id=""){const n=normalizeName(name);return state.exercises.find(x=>x.id!==id&&(normalizeName(x.name)===n||normalizeName(x.name).includes(n)||n.includes(normalizeName(x.name))))}
function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)})}

function renderHeader(){
  $("headerDate").textContent=prettyDate(todayKey());
  $("workoutTitle").textContent=selectedDate===todayKey()?"Today's workout":`${prettyDate(selectedDate)} workout`;
  $("selectedDateLabel").textContent=selectedDate;
  const m=state.metrics[todayKey()]||{};
  $("todayWeight").value=m.weight??"";$("todayBodyFat").value=m.bodyFat??"";
}
function renderWeek(){
  const now=new Date(),start=new Date(now);start.setDate(now.getDate()-now.getDay()+weekOffset*7);
  const host=$("weekStrip");host.innerHTML="";
  for(let i=0;i<7;i++){
    const d=new Date(start);d.setDate(start.getDate()+i);const key=keyFromDate(d),w=workoutFor(key);
    const status=w?.items?.length?(w.items.every(isDone)?"✓":"P"):"";
    const b=document.createElement("button");b.className="week-day"+(key===todayKey()?" today":"")+(key===selectedDate?" selected":"");
    b.innerHTML=`<small>${new Intl.DateTimeFormat("en-US",{weekday:"narrow"}).format(d)}</small><b>${d.getDate()}</b><em>${status}</em>`;
    b.onclick=()=>{selectedDate=key;renderAll()};host.appendChild(b);
  }
  const atToday=weekOffset===0&&selectedDate===todayKey(),backBtn=$("backThisWeekBtn");
  backBtn.classList.toggle("slot-hidden",atToday);backBtn.disabled=atToday;backBtn.setAttribute("aria-hidden",String(atToday));
}
function workoutGroups(w){
  const groups=[];
  const groupedIds=new Set();
  for(const planId of w.planIds||[]){
    const entries=w.items.filter(x=>x.sourcePlanId===planId).sort((a,b)=>(a.sourcePlanOrder??9999)-(b.sourcePlanOrder??9999));
    if(!entries.length)continue;
    const plan=planById(planId),name=plan?.name||entries[0]?.sourcePlanName||"Saved plan";
    groups.push({key:`plan-${planId}`,name,entries});
    entries.forEach(x=>groupedIds.add(x.id));
  }
  const orphanPlanIds=[...new Set(w.items.filter(x=>x.sourcePlanId&&!groupedIds.has(x.id)).map(x=>x.sourcePlanId))];
  for(const planId of orphanPlanIds){
    const entries=w.items.filter(x=>x.sourcePlanId===planId&&!groupedIds.has(x.id)).sort((a,b)=>(a.sourcePlanOrder??9999)-(b.sourcePlanOrder??9999));
    if(!entries.length)continue;
    groups.push({key:`plan-${planId}`,name:planById(planId)?.name||entries[0]?.sourcePlanName||"Saved plan",entries});
    entries.forEach(x=>groupedIds.add(x.id));
  }
  for(const category of sections){
    const entries=w.items.filter(x=>!groupedIds.has(x.id)&&itemCategory(x)===category);
    if(entries.length)groups.push({key:`category-${category}`,name:labels[category],entries});
  }
  return groups;
}
function renderWorkout(){
  const host=$("workoutSections"),w=workoutFor(selectedDate);host.innerHTML="";
  if(!w?.items?.length){host.innerHTML='<p class="muted">No workout planned for this date.</p>';return}
  for(const group of workoutGroups(w)){
    const entries=group.entries,doneCount=entries.filter(isDone).length;
    const section=document.createElement("section");section.className="workout-section";
    const header=document.createElement("button");header.className="workout-section-header";
    const titleWrap=document.createElement("span"),title=document.createElement("b"),progress=document.createElement("small"),chevron=document.createElement("b");
    title.textContent=group.name;progress.textContent=`${doneCount}/${entries.length} complete`;chevron.textContent="⌄";titleWrap.append(title,progress);header.append(titleWrap,chevron);
    const body=document.createElement("div");body.className="workout-section-body";
    const storageKey=`section-open-${selectedDate}-${group.key}`;
    let open=localStorage.getItem(storageKey)!=="false";
    if(doneCount===entries.length)open=false;
    body.classList.toggle("hidden",!open);
    header.onclick=()=>{open=!open;body.classList.toggle("hidden",!open);localStorage.setItem(storageKey,String(open))};
    let divider=false;
    for(const item of entries){
      if(isDone(item)&&!divider){const d=document.createElement("div");d.className="completed-label";d.textContent="Completed";body.appendChild(d);divider=true}
      body.appendChild(renderWorkoutItem(item));
    }
    section.append(header,body);host.appendChild(section);
  }
}
function closeExerciseMenus(except=null){
  document.querySelectorAll(".workout-item .item-menu").forEach(menu=>{
    if(menu===except)return;
    menu.classList.add("hidden");
    menu.closest(".workout-item")?.querySelector(".more")?.setAttribute("aria-expanded","false");
  });
}
function openRemoveExerciseDialog(item,displayName){
  closeExerciseMenus();
  pendingExerciseRemoval={date:selectedDate,itemId:item.id};
  $("removeExerciseName").textContent=displayName;
  showDialog("removeExerciseDialog");
}
function renderWorkoutItem(item){
  const ex=exById(item.exerciseId),displayName=ex?.name||item.exerciseName||"Exercise",card=document.createElement("div");card.className="workout-item"+(isDone(item)?" completed":"");
  card.innerHTML=`<div class="item-head"><div><strong>${displayName}</strong><div class="muted">${labels[itemCategory(item)]}</div></div><div class="item-actions"><button class="secondary reference" type="button">Reference</button><button class="secondary more" type="button" aria-label="Exercise options" aria-expanded="false">⋯</button></div></div><div class="item-menu hidden"><button class="remove-menu-item" type="button">Remove exercise</button></div><div class="item-body"></div>`;
  const menu=card.querySelector(".item-menu"),more=card.querySelector(".more");
  more.onclick=e=>{e.stopPropagation();const willOpen=menu.classList.contains("hidden");closeExerciseMenus(menu);menu.classList.toggle("hidden",!willOpen);more.setAttribute("aria-expanded",String(willOpen))};
  menu.onclick=e=>e.stopPropagation();
  card.querySelector(".remove-menu-item").onclick=()=>openRemoveExerciseDialog(item,displayName);
  card.querySelector(".reference").onclick=()=>showReference(ex);
  const body=card.querySelector(".item-body");
  if(item.type==="cardio"){
    item.intervals ||= [{minutes:10,heartRate:"",done:false}];
    item.intervals.forEach((interval,index)=>{
      const row=document.createElement("div");row.className="cardio-interval-row";
      row.innerHTML=`<div class="cardio-interval-head"><b>Split ${index+1}</b><button type="button" class="secondary remove-interval" aria-label="Remove split ${index+1}">×</button></div><div class="cardio-interval-fields"><div class="unit-input"><input type="number" min="1" value="${interval.minutes}" aria-label="Split ${index+1} minutes"><b>min</b></div><div class="unit-input"><input type="number" min="1" value="${interval.heartRate??""}" placeholder="Heart rate" aria-label="Split ${index+1} heart rate"><b>bpm</b></div><button type="button" class="${interval.done?"":"secondary"}" aria-label="Mark split ${index+1} ${interval.done?"not complete":"complete"}">${interval.done?"✓":"○"}</button></div>`;
      row.querySelector('.cardio-interval-fields .unit-input:nth-child(1) input').onchange=e=>{interval.minutes=Number(e.target.value)||1;saveState(state)};
      row.querySelector('.cardio-interval-fields .unit-input:nth-child(2) input').onchange=e=>{interval.heartRate=e.target.value;saveState(state)};
      row.querySelector('.cardio-interval-fields button').onclick=()=>{interval.done=!interval.done;persist()};
      const remove=row.querySelector('.remove-interval');remove.disabled=item.intervals.length<=1;
      remove.onclick=()=>{if(item.intervals.length<=1)return;item.intervals.splice(index,1);persist()};
      body.appendChild(row);
    });
    const controls=document.createElement("div");controls.className="cardio-controls";
    controls.innerHTML='<button type="button" class="secondary">＋ Interval</button>';
    controls.firstElementChild.onclick=()=>{const last=item.intervals.at(-1)||{minutes:10};item.intervals.push({minutes:last.minutes||10,heartRate:"",done:false});persist()};
    body.appendChild(controls);
  }else{
    item.sets.forEach(set=>{
      const row=document.createElement("div");row.className="set-row";
      row.innerHTML=`<div class="unit-input"><input type="number" min="0" value="${set.reps||0}" aria-label="Reps"><b>reps</b></div><div class="unit-input"><input type="number" min="0" step="0.5" value="${set.weight||0}" aria-label="Weight"><b>lb</b></div><button class="${set.done?"":"secondary"}">${set.done?"✓":"○"}</button>`;
      row.children[0].querySelector("input").onchange=e=>{set.reps=Number(e.target.value)||0;saveState(state)};
      row.children[1].querySelector("input").onchange=e=>{set.weight=Number(e.target.value)||0;saveState(state)};
      row.children[2].onclick=()=>{set.done=!set.done;persist()};
      body.appendChild(row);
    });
    const controls=document.createElement("div");controls.className="set-controls";
    controls.innerHTML='<button class="secondary">− Set</button><button>＋ Set</button>';
    controls.children[0].onclick=()=>{if(item.sets.length>1){item.sets.pop();persist()}};
    controls.children[1].onclick=()=>{const last=item.sets.at(-1)||{weight:0,reps:12};item.sets.push({weight:last.weight,reps:last.reps,done:false});persist()};
    body.appendChild(controls);
  }
  return card;
}
function showReference(ex){
  $("referenceTitle").textContent=ex?.name||"Reference";
  $("referenceImage").classList.toggle("hidden",!ex?.photo);$("referenceImage").src=ex?.photo||"";
  $("referenceNotes").classList.toggle("hidden",!ex?.notes);$("referenceNotes").textContent=ex?.notes||"";
  $("referenceLink").classList.toggle("hidden",!ex?.link);$("referenceLink").href=ex?.link||"#";
  $("referenceEmpty").classList.toggle("hidden",Boolean(ex?.photo||ex?.notes||ex?.link));
  showDialog("referenceDialog");
}

function renderPlans(){
  const host=$("plansList");
  if(!state.plans.length){host.innerHTML='<article class="card"><p class="muted">No plans yet.</p></article>';return}
  host.innerHTML=state.plans.map(p=>{
    const names=(p.items||[]).map(x=>exById(x.exerciseId)?.name||x.exerciseName||"Exercise");
    return `<article class="list-card"><strong>${p.name}</strong><p class="muted">${p.notes||""}</p><p>${names.join(", ")||"No items"}</p><div class="actions"><button class="secondary edit-plan" data-id="${p.id}">Edit</button><button class="secondary duplicate-plan" data-id="${p.id}">Duplicate</button><button class="danger delete-plan" data-id="${p.id}">Delete</button></div></article>`;
  }).join("");
  host.querySelectorAll(".edit-plan").forEach(b=>b.onclick=()=>openPlan(state.plans.find(x=>x.id===b.dataset.id)));
  host.querySelectorAll(".duplicate-plan").forEach(b=>b.onclick=()=>{const p=structuredClone(state.plans.find(x=>x.id===b.dataset.id));p.id=crypto.randomUUID();p.name+=" Copy";state.plans.push(p);persist()});
  host.querySelectorAll(".delete-plan").forEach(b=>b.onclick=()=>{if(confirm("Delete this plan?")){state.plans=state.plans.filter(x=>x.id!==b.dataset.id);persist()}});
}
function openPlan(plan=null){
  planDraft=plan?structuredClone(plan):{id:"",name:"",notes:"",items:[]};
  planDraft.items ||= [];
  $("planDialogTitle").textContent=plan?"Edit plan":"Add plan";$("planId").value=planDraft.id;$("planName").value=planDraft.name;$("planNotes").value=planDraft.notes;
  $("planCategorySelect").value="warmup";intervalDraft=[10,10];populatePlanExerciseOptions();updatePlanFields();renderPlanIntervals();renderPlanDraft();showDialog("planDialog");
}
function populatePlanExerciseOptions(){
  const category=$("planCategorySelect").value,used=new Set((planDraft.items||[]).map(x=>x.exerciseId));
  const available=state.exercises.filter(x=>!x.archived&&x.category===category&&!used.has(x.id));
  $("planExerciseSelect").innerHTML=available.length?available.map(x=>`<option value="${x.id}">${x.name}</option>`).join(""):'<option value="">No available exercise</option>';
}
function updatePlanFields(){
  const category=$("planCategorySelect").value;
  $("planStrengthFields").classList.toggle("hidden",category==="cardio");$("planCardioFields").classList.toggle("hidden",category!=="cardio");
  $("planSets").value=category==="strength"?2:1;$("planReps").value=category==="strength"?12:(category==="flexibility"?30:6);
}
function renderPlanIntervals(){
  $("planCardioIntervals").innerHTML=intervalDraft.map((m,i)=>`<div class="set-row"><div class="unit-input"><input data-i="${i}" type="number" min="1" value="${m}"><b>min</b></div><span></span><button type="button" class="secondary remove-plan-interval" data-i="${i}">×</button></div>`).join("");
  $("planCardioIntervals").querySelectorAll("input").forEach(x=>x.onchange=e=>intervalDraft[Number(e.target.dataset.i)]=Number(e.target.value)||1);
  $("planCardioIntervals").querySelectorAll(".remove-plan-interval").forEach(b=>b.onclick=()=>{if(intervalDraft.length>1){intervalDraft.splice(Number(b.dataset.i),1);renderPlanIntervals()}});
}
function movePlanItem(id,newIndex){
  const oldIndex=planDraft.items.findIndex(x=>x.id===id);if(oldIndex<0)return;
  const [item]=planDraft.items.splice(oldIndex,1);newIndex=Math.max(0,Math.min(newIndex,planDraft.items.length));planDraft.items.splice(newIndex,0,item);renderPlanDraft();
}
function renderPlanDraft(){
  const list=planDraft.items||[],host=$("planItemsList");
  host.innerHTML=list.map((x,index)=>{
    const ex=exById(x.exerciseId),summary=x.type==="cardio"?`${(x.intervals||[]).join(" / ")} min`:`${x.sets} × ${x.reps}`;
    return `<div class="plan-item" draggable="true" data-id="${x.id}"><div class="plan-item-main"><span class="drag-handle" aria-hidden="true">≡</span><div class="plan-item-content"><strong>${ex?.name||x.exerciseName||"Exercise"}</strong><div class="muted">${summary}</div><span class="plan-item-category">${labels[x.category]||"Exercise"}</span></div></div><div class="plan-item-actions"><button type="button" class="secondary move-plan-up" data-id="${x.id}" ${index===0?"disabled":""} aria-label="Move up">↑</button><button type="button" class="secondary move-plan-down" data-id="${x.id}" ${index===list.length-1?"disabled":""} aria-label="Move down">↓</button><button type="button" class="secondary remove-plan-item" data-id="${x.id}">Remove</button></div></div>`;
  }).join("")||'<p class="muted">No items.</p>';
  host.querySelectorAll(".remove-plan-item").forEach(b=>b.onclick=()=>{planDraft.items=planDraft.items.filter(x=>x.id!==b.dataset.id);renderPlanDraft();populatePlanExerciseOptions()});
  host.querySelectorAll(".move-plan-up").forEach(b=>b.onclick=()=>{const i=planDraft.items.findIndex(x=>x.id===b.dataset.id);movePlanItem(b.dataset.id,i-1)});
  host.querySelectorAll(".move-plan-down").forEach(b=>b.onclick=()=>{const i=planDraft.items.findIndex(x=>x.id===b.dataset.id);movePlanItem(b.dataset.id,i+1)});
  let draggedId=null;
  host.querySelectorAll(".plan-item").forEach(card=>{
    card.ondragstart=e=>{draggedId=card.dataset.id;card.classList.add("dragging");e.dataTransfer.effectAllowed="move"};
    card.ondragend=()=>{card.classList.remove("dragging");draggedId=null};
    card.ondragover=e=>{e.preventDefault();e.dataTransfer.dropEffect="move"};
    card.ondrop=e=>{e.preventDefault();if(!draggedId||draggedId===card.dataset.id)return;const draggedIndex=planDraft.items.findIndex(x=>x.id===draggedId),targetIndex=planDraft.items.findIndex(x=>x.id===card.dataset.id),rect=card.getBoundingClientRect(),after=e.clientY>rect.top+rect.height/2;let newIndex=targetIndex+(after?1:0);if(draggedIndex<newIndex)newIndex--;movePlanItem(draggedId,newIndex)};
  });
}
function addCurrentPlanItem(){
  const id=$("planExerciseSelect").value,ex=exById(id);if(!ex)return alert("No exercise available.");if(planDraft.items.some(x=>x.exerciseId===id))return alert("Exercise already added.");
  let item;if(ex.category==="cardio")item={id:crypto.randomUUID(),exerciseId:id,exerciseName:ex.name,category:"cardio",type:"cardio",intervals:[...intervalDraft]};
  else item={id:crypto.randomUUID(),exerciseId:id,exerciseName:ex.name,category:ex.category,type:"exercise",sets:Number($("planSets").value)||1,reps:Number($("planReps").value)||1};
  planDraft.items.push(item);intervalDraft=[10,10];renderPlanDraft();populatePlanExerciseOptions();renderPlanIntervals();
}
function addPlanToWorkout(plan){
  const w=workoutFor(selectedDate,true);if(w.planIds.includes(plan.id))return false;
  const used=new Set(w.items.map(x=>x.exerciseId));
  (plan.items||[]).forEach((x,sourcePlanOrder)=>{
    if(used.has(x.exerciseId))return;
    const ex=exById(x.exerciseId),exerciseName=ex?.name||x.exerciseName||"Exercise",sourceMeta={sourcePlanId:plan.id,sourcePlanName:plan.name,sourcePlanItemId:x.id,sourcePlanOrder};
    if(x.type==="cardio")w.items.push({id:crypto.randomUUID(),exerciseId:x.exerciseId,exerciseName,category:"cardio",type:"cardio",intervals:(x.intervals||[10]).map(minutes=>({minutes,heartRate:"",done:false})),...sourceMeta});
    else w.items.push({id:crypto.randomUUID(),exerciseId:x.exerciseId,exerciseName,category:x.category,type:"exercise",sets:Array.from({length:x.sets||1},()=>({weight:0,reps:x.reps||1,done:false})),...sourceMeta});
    used.add(x.exerciseId);
  });
  w.planIds.push(plan.id);return true;
}

function renderLibrary(){
  const q=$("librarySearch").value.trim().toLowerCase(),host=$("libraryList");host.innerHTML="";
  for(const category of sections){
    const list=activeExercises(category).filter(x=>(x.name+" "+x.muscle+" "+x.notes).toLowerCase().includes(q));
    if(!list.length)continue;
    const sec=document.createElement("section");sec.className="library-section";sec.innerHTML=`<h3>${labels[category]} (${list.length})</h3>`;
    for(const ex of list){const card=document.createElement("article");card.className="list-card";
      card.innerHTML=`<strong>${ex.name}</strong><p class="muted">${ex.muscle||"No muscle group"}</p>${ex.photo?`<img src="${ex.photo}" class="reference-photo" alt="">`:""}${ex.notes?`<p>${ex.notes}</p>`:""}${ex.link?`<a href="${ex.link}" target="_blank" rel="noopener">Open reference</a>`:""}<div class="actions"><button class="secondary edit-exercise">Edit</button><button class="danger delete-exercise">Delete</button></div>`;
      card.querySelector(".edit-exercise").onclick=()=>openExercise(ex);
      card.querySelector(".delete-exercise").onclick=()=>deleteExercise(ex);
      sec.appendChild(card);
    }
    host.appendChild(sec);
  }
  if(!host.children.length)host.innerHTML='<article class="card"><p class="muted">No matching exercises.</p></article>';
}
function deleteExercise(ex){
  const planCount=state.plans.filter(p=>(p.items||[]).some(i=>i.exerciseId===ex.id)).length;
  const workoutCount=Object.values(state.workouts).filter(w=>(w.items||[]).some(i=>i.exerciseId===ex.id)).length;
  const detail=(planCount||workoutCount)?`\n\nUsed in ${planCount} plan(s) and ${workoutCount} workout date(s). Workout history will keep the exercise name.`:"";
  if(!confirm(`Delete "${ex.name}"?${detail}`))return;
  state.plans.forEach(p=>{p.items=(p.items||[]).filter(i=>i.exerciseId!==ex.id)});
  Object.values(state.workouts).forEach(w=>(w.items||[]).forEach(i=>{if(i.exerciseId===ex.id)i.exerciseName ||= ex.name}));
  state.exercises=state.exercises.filter(x=>x.id!==ex.id);persist();
}
function renderProgress(){
  const rows=Object.entries(state.metrics).sort(([a],[b])=>b.localeCompare(a)),latest=rows[0]?.[1];
  if(!latest)$("progressSummary").innerHTML='<h3>Current</h3><p class="muted">No body records yet.</p>';
  else{const fat=latest.weight*latest.bodyFat/100,lean=latest.weight-fat;$("progressSummary").innerHTML=`<h3>Current</h3><div class="progress-grid"><div class="stat"><span>Weight</span><b>${latest.weight.toFixed(1)} lb</b></div><div class="stat"><span>Body fat</span><b>${latest.bodyFat.toFixed(1)}%</b></div><div class="stat"><span>Fat mass</span><b>${fat.toFixed(1)} lb</b></div><div class="stat"><span>Lean body mass</span><b>${lean.toFixed(1)} lb</b></div></div>`}
  $("progressHistory").innerHTML=rows.slice(0,20).map(([date,m])=>{const fat=m.weight*m.bodyFat/100,lean=m.weight-fat;return `<div class="history-row"><b>${date}</b><span>${m.weight.toFixed(1)}</span><span>${m.bodyFat.toFixed(1)}%</span><span>${fat.toFixed(1)} fat</span><span>${lean.toFixed(1)} lean</span></div>`}).join("")||'<p class="muted">No records.</p>';
}
function renderAll(){renderHeader();renderWeek();renderWorkout();renderPlans();renderLibrary();renderProgress()}

function openExercise(ex=null){
  $("exerciseDialogTitle").textContent=ex?"Edit exercise":"Add exercise";$("exerciseId").value=ex?.id||"";$("exerciseName").value=ex?.name||"";$("exerciseCategory").value=ex?.category||"strength";$("exerciseMuscle").value=ex?.muscle||"";$("exerciseLink").value=ex?.link||"";$("exerciseNotes").value=ex?.notes||"";$("exercisePhoto").value="";showDialog("exerciseDialog");
}
function populateAddWorkout(){
  const w=workoutFor(selectedDate,true),used=new Set(w.items.map(x=>x.exerciseId));
  $("availablePlansSelect").innerHTML=state.plans.filter(p=>!w.planIds.includes(p.id)).map(p=>`<option value="${p.id}">${p.name}</option>`).join("")||'<option value="">No available plans</option>';
  $("availableExercisesSelect").innerHTML=state.exercises.filter(x=>!x.archived&&["strength","cardio"].includes(x.category)&&!used.has(x.id)).map(x=>`<option value="${x.id}" data-category="${x.category}">${x.name}</option>`).join("")||'<option value="">No available exercise</option>';
  intervalDraft=[10,10];updateQuickExerciseFields();renderQuickIntervals();
}
function updateAddMode(){const mode=document.querySelector('input[name="addMode"]:checked').value;$("addPlanPanel").classList.toggle("hidden",mode!=="plan");$("addExercisePanel").classList.toggle("hidden",mode!=="exercise")}
function updateQuickExerciseFields(){const c=$("availableExercisesSelect").selectedOptions[0]?.dataset.category||"strength";$("strengthQuickFields").classList.toggle("hidden",c!=="strength");$("cardioQuickFields").classList.toggle("hidden",c!=="cardio")}
function renderQuickIntervals(){
  $("quickCardioIntervals").innerHTML=intervalDraft.map((m,i)=>`<div class="set-row"><div class="unit-input"><input data-i="${i}" type="number" min="1" value="${m}"><b>min</b></div><span></span><button type="button" class="secondary remove-quick-interval" data-i="${i}">×</button></div>`).join("");
  $("quickCardioIntervals").querySelectorAll("input").forEach(x=>x.onchange=e=>intervalDraft[Number(e.target.dataset.i)]=Number(e.target.value)||1);
  $("quickCardioIntervals").querySelectorAll(".remove-quick-interval").forEach(b=>b.onclick=()=>{if(intervalDraft.length>1){intervalDraft.splice(Number(b.dataset.i),1);renderQuickIntervals()}});
}
function setAddMode(mode="plan"){
  const input=document.querySelector(`input[name="addMode"][value="${mode}"]`);
  if(input)input.checked=true;
  updateAddMode();
}
function resetAddWorkoutDialog(){
  $("addWorkoutForm").reset();
  $("addWorkoutForm").scrollTop=0;
  intervalDraft=[10,10];
  setAddMode("plan");
}
function showDialog(id){
  const dialog=$(id);
  document.body.classList.add("modal-open");
  if(!dialog.open)dialog.showModal();
  const scroller=dialog.querySelector("form,.reference-dialog-content");
  if(scroller)scroller.scrollTop=0;
}
function closeDialog(id){
  const dialog=$(id);
  if(dialog?.open)dialog.close();
}
function syncModalLock(){
  document.body.classList.toggle("modal-open",Boolean(document.querySelector("dialog[open]")));
}

document.addEventListener("click",()=>closeExerciseMenus());
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeExerciseMenus()});
document.querySelectorAll(".bottom-nav button").forEach(b=>b.onclick=()=>{document.querySelectorAll(".bottom-nav button").forEach(x=>x.classList.remove("active"));b.classList.add("active");document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));$(b.dataset.view).classList.add("active");renderAll()});
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeDialog(b.dataset.close));
document.querySelectorAll("dialog").forEach(d=>d.addEventListener("close",()=>{if(d.id==="addWorkoutDialog")resetAddWorkoutDialog();if(d.id==="removeExerciseDialog")pendingExerciseRemoval=null;syncModalLock()}));
$("saveMetricsBtn").onclick=()=>{const weight=Number($("todayWeight").value),bodyFat=Number($("todayBodyFat").value);if(!weight||!bodyFat)return alert("Enter weight and body fat.");state.metrics[todayKey()]={weight,bodyFat};persist()};
$("previousWeekBtn").onclick=()=>{weekOffset--;renderWeek()};$("nextWeekBtn").onclick=()=>{weekOffset++;renderWeek()};$("backThisWeekBtn").onclick=()=>{weekOffset=0;selectedDate=todayKey();renderAll()};
$("openAddWorkoutBtn").onclick=()=>{resetAddWorkoutDialog();populateAddWorkout();setAddMode("plan");showDialog("addWorkoutDialog")};
$("removeExerciseForm").onsubmit=e=>{
  e.preventDefault();
  const pending=pendingExerciseRemoval;
  if(!pending)return closeDialog("removeExerciseDialog");
  const workout=workoutFor(pending.date);
  if(workout?.items)workout.items=workout.items.filter(x=>x.id!==pending.itemId);
  closeDialog("removeExerciseDialog");
  persist();
};
document.querySelectorAll('input[name="addMode"]').forEach(r=>r.onchange=updateAddMode);$("availableExercisesSelect").onchange=updateQuickExerciseFields;$("addQuickCardioIntervalBtn").onclick=()=>{intervalDraft.push(intervalDraft.at(-1)||10);renderQuickIntervals()};
$("addWorkoutForm").onsubmit=e=>{e.preventDefault();const mode=document.querySelector('input[name="addMode"]:checked').value,w=workoutFor(selectedDate,true);if(mode==="plan"){const p=state.plans.find(x=>x.id===$("availablePlansSelect").value);if(!p)return alert("No plan available.");if(!addPlanToWorkout(p))return alert("Plan already added.")}else{const id=$("availableExercisesSelect").value,ex=exById(id);if(!ex)return alert("No exercise available.");if(w.items.some(x=>x.exerciseId===id))return alert("Exercise already added.");if(ex.category==="cardio")w.items.push({id:crypto.randomUUID(),exerciseId:id,exerciseName:ex.name,category:"cardio",type:"cardio",intervals:intervalDraft.map(minutes=>({minutes,heartRate:"",done:false}))});else w.items.push({id:crypto.randomUUID(),exerciseId:id,exerciseName:ex.name,category:"strength",type:"exercise",sets:Array.from({length:Number($("quickSets").value)||2},()=>({weight:0,reps:Number($("quickReps").value)||12,done:false}))})}closeDialog("addWorkoutDialog");persist()};
$("addExerciseBtn").onclick=()=>openExercise();
$("exerciseForm").onsubmit=async e=>{e.preventDefault();const id=$("exerciseId").value,name=$("exerciseName").value.trim();if(!name)return;const exact=state.exercises.some(x=>x.id!==id&&normalizeName(x.name)===normalizeName(name));if(exact)return alert("This exercise already exists.");const similar=similarName(name,id);if(similar&&!confirm(`A similar exercise already exists: ${similar.name}\n\nSave anyway?`))return;const old=id?exById(id):null;let photo=old?.photo||"";if($("exercisePhoto").files[0])photo=await fileToDataUrl($("exercisePhoto").files[0]);const record={id:id||crypto.randomUUID(),name,category:$("exerciseCategory").value,muscle:$("exerciseMuscle").value.trim(),photo,link:$("exerciseLink").value.trim(),notes:$("exerciseNotes").value.trim(),archived:false};if(id)state.exercises[state.exercises.findIndex(x=>x.id===id)]=record;else state.exercises.push(record);closeDialog("exerciseDialog");persist()};
$("librarySearch").oninput=renderLibrary;
$("addPlanBtn").onclick=()=>openPlan();$("planCategorySelect").onchange=()=>{populatePlanExerciseOptions();updatePlanFields();intervalDraft=[10,10];renderPlanIntervals()};$("addPlanCardioIntervalBtn").onclick=()=>{intervalDraft.push(intervalDraft.at(-1)||10);renderPlanIntervals()};$("addPlanItemInlineBtn").onclick=addCurrentPlanItem;
$("planForm").onsubmit=e=>{e.preventDefault();planDraft.name=$("planName").value.trim();planDraft.notes=$("planNotes").value.trim();if(!planDraft.name)return;planDraft.id=planDraft.id||crypto.randomUUID();const i=state.plans.findIndex(x=>x.id===planDraft.id);if(i>=0)state.plans[i]=structuredClone(planDraft);else state.plans.push(structuredClone(planDraft));closeDialog("planDialog");persist()};
$("exportBackupBtn").onclick=()=>downloadBackup(state);$("restoreBackupInput").onchange=async e=>{const f=e.target.files[0];if(!f)return;try{state=JSON.parse(await f.text());saveState(state);renderAll();alert("Backup restored.")}catch{alert("Invalid backup file.")}};$("clearDataBtn").onclick=()=>{if(confirm("Clear all local data?")){state=makeDefaultState();saveState(state);selectedDate=todayKey();weekOffset=0;renderAll()}};
if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
renderAll();
