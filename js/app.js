import {loadState,saveState,makeDefaultState,downloadBackup} from "./storage.js";

let state=loadState();
let selectedDate=todayKey();
let weekOffset=0;
let planDraft=null;
let intervalDraft=[10,10];
let pendingUndo=null;
let undoTimer=null;
let exercisePhotoDraft="";
let exercisePhotoMessage="";

const $=id=>document.getElementById(id);
const sections=["warmup","strength","cardio","flexibility"];
const labels={warmup:"Warm up",strength:"Strength",cardio:"Cardio",flexibility:"Flexibility"};

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
function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=reject;
    reader.onload=()=>{
      const raw=reader.result;
      if(!file.type?.startsWith("image/"))return resolve(raw);
      const img=new Image();
      img.onload=()=>{
        const maxSide=1200,scale=Math.min(1,maxSide/Math.max(img.width,img.height));
        const canvas=document.createElement("canvas");
        canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
        const ctx=canvas.getContext("2d");
        ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
        canvas.toBlob(blob=>{
          if(!blob)return resolve(raw);
          const r2=new FileReader();r2.onload=()=>resolve(r2.result);r2.onerror=()=>resolve(raw);r2.readAsDataURL(blob);
        },"image/jpeg",0.82);
      };
      img.onerror=()=>resolve(raw);
      img.src=raw;
    };
    reader.readAsDataURL(file);
  });
}
function planMissingItems(plan,w){
  const used=new Set((w?.items||[]).map(x=>x.exerciseId));
  return (plan.items||[]).filter(x=>!used.has(x.exerciseId));
}
function planOptionLabel(plan,w){
  const total=(plan.items||[]).length,missing=planMissingItems(plan,w).length;
  if(!total)return `${plan.name} — Empty`;
  if(missing===0)return `✓ ${plan.name} — Added`;
  if(missing<total)return `${plan.name} — ${missing} missing`;
  return plan.name;
}
function showUndoToast(text,undoFn){
  pendingUndo=undoFn;clearTimeout(undoTimer);
  $("undoToastText").textContent=text;
  $("undoToast").classList.remove("hidden");
  undoTimer=setTimeout(hideUndoToast,7000);
}
function hideUndoToast(){
  clearTimeout(undoTimer);undoTimer=null;pendingUndo=null;
  $("undoToast")?.classList.add("hidden");
}
function removeWorkoutItem(item){
  const date=selectedDate,w=workoutFor(date,true),index=w.items.findIndex(x=>x.id===item.id);
  if(index<0)return;
  const [removed]=w.items.splice(index,1),name=removed.exerciseName||exById(removed.exerciseId)?.name||"Exercise";
  saveState(state);renderAll();
  showUndoToast(`Removed ${name}.`,()=>{
    const target=workoutFor(date,true);
    if(!target.items.some(x=>x.id===removed.id||x.exerciseId===removed.exerciseId))target.items.splice(Math.min(index,target.items.length),0,removed);
    selectedDate=date;saveState(state);renderAll();hideUndoToast();
  });
}
function updateExercisePhotoPreview(){
  const hasPhoto=Boolean(exercisePhotoDraft),hasMessage=Boolean(exercisePhotoMessage);
  $("exercisePhotoTools").classList.toggle("hidden",!hasPhoto);
  $("exercisePhotoPreview").src=hasPhoto?exercisePhotoDraft:"";
  $("exercisePhotoStatus").classList.toggle("hidden",!hasMessage);
  $("exercisePhotoStatus").textContent=exercisePhotoMessage;
}

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
  const showReturn=!(weekOffset===0&&selectedDate===todayKey());
  $("backThisWeekBtn").classList.toggle("visible",showReturn);
  $("backThisWeekBtn").setAttribute("aria-hidden",String(!showReturn));
}
function renderWorkout(){
  const host=$("workoutSections"),w=workoutFor(selectedDate);host.innerHTML="";
  if(!w?.items?.length){host.innerHTML='<p class="muted">No workout planned for this date.</p>';return}
  for(const category of sections){
    const entries=w.items.filter(x=>itemCategory(x)===category);
    if(!entries.length)continue;
    const doneCount=entries.filter(isDone).length;
    const section=document.createElement("section");section.className="workout-section";
    const header=document.createElement("button");header.className="workout-section-header";
    header.innerHTML=`<span><b>${labels[category]}</b><small>${doneCount}/${entries.length} complete</small></span><b>⌄</b>`;
    const body=document.createElement("div");body.className="workout-section-body";
    const storageKey=`section-open-${selectedDate}-${category}`;
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
function renderWorkoutItem(item){
  const ex=exById(item.exerciseId),displayName=ex?.name||item.exerciseName||"Exercise",card=document.createElement("div");card.className="workout-item"+(isDone(item)?" completed":"");
  card.innerHTML=`<div class="item-head"><div><strong>${displayName}</strong><div class="muted">${labels[itemCategory(item)]}</div></div><div class="item-actions"><button class="secondary reference" type="button">Ref</button><button class="secondary remove" type="button" aria-label="Remove exercise">×</button></div></div><div class="item-body"></div>`;
  card.querySelector(".remove").onclick=()=>removeWorkoutItem(item);
  card.querySelector(".reference").onclick=()=>showReference(ex);
  const body=card.querySelector(".item-body");
  if(item.type==="cardio"){
    (item.intervals||[]).forEach(interval=>{
      const row=document.createElement("div");row.className="set-row";
      row.innerHTML=`<div class="unit-input"><input type="number" min="1" value="${interval.minutes}"><b>min</b></div><input placeholder="Target HR" value="${item.targetHr||""}"><button class="${interval.done?"":"secondary"}">${interval.done?"✓":"○"}</button>`;
      row.children[0].querySelector("input").onchange=e=>{interval.minutes=Number(e.target.value)||1;saveState(state)};
      row.children[1].onchange=e=>{item.targetHr=e.target.value;saveState(state)};
      row.children[2].onclick=()=>{interval.done=!interval.done;persist()};
      body.appendChild(row);
    });
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
function renderPlanDraft(){
  const grouped=sections.map(category=>{
    const list=(planDraft.items||[]).filter(x=>x.category===category);
    if(!list.length)return "";
    return `<h3 class="plan-items-heading">${labels[category]}</h3>`+list.map(x=>{
      const ex=exById(x.exerciseId),summary=x.type==="cardio"?`${(x.intervals||[]).join(" / ")} min`:`${x.sets} × ${x.reps}`;
      return `<div class="plan-item"><div class="section-head"><div><strong>${ex?.name||x.exerciseName||"Exercise"}</strong><div class="muted">${summary}</div></div><button type="button" class="secondary remove-plan-item" data-id="${x.id}">Remove</button></div></div>`;
    }).join("");
  }).join("");
  $("planItemsList").innerHTML=grouped||'<p class="muted">No items.</p>';
  $("planItemsList").querySelectorAll(".remove-plan-item").forEach(b=>b.onclick=()=>{planDraft.items=planDraft.items.filter(x=>x.id!==b.dataset.id);renderPlanDraft();populatePlanExerciseOptions()});
}
function addCurrentPlanItem(){
  const id=$("planExerciseSelect").value,ex=exById(id);if(!ex)return alert("No exercise available.");if(planDraft.items.some(x=>x.exerciseId===id))return alert("Exercise already added.");
  let item;if(ex.category==="cardio")item={id:crypto.randomUUID(),exerciseId:id,exerciseName:ex.name,category:"cardio",type:"cardio",intervals:[...intervalDraft]};
  else item={id:crypto.randomUUID(),exerciseId:id,exerciseName:ex.name,category:ex.category,type:"exercise",sets:Number($("planSets").value)||1,reps:Number($("planReps").value)||1};
  planDraft.items.push(item);intervalDraft=[10,10];renderPlanDraft();populatePlanExerciseOptions();renderPlanIntervals();
}
function addPlanToWorkout(plan){
  const w=workoutFor(selectedDate,true),used=new Set(w.items.map(x=>x.exerciseId)),source=(plan.items||[]).filter(x=>!used.has(x.exerciseId));
  if(!source.length)return false;
  for(const x of source){const ex=exById(x.exerciseId),exerciseName=ex?.name||x.exerciseName||"Exercise",category=x.category||ex?.category||"strength";
    if(x.type==="cardio")w.items.push({id:crypto.randomUUID(),exerciseId:x.exerciseId,exerciseName,category:"cardio",type:"cardio",intervals:(x.intervals||[10]).map(minutes=>({minutes,done:false})),targetHr:""});
    else w.items.push({id:crypto.randomUUID(),exerciseId:x.exerciseId,exerciseName,category,type:"exercise",sets:Array.from({length:x.sets||1},()=>({weight:0,reps:x.reps||1,done:false}))});
  }
  if(!w.planIds.includes(plan.id))w.planIds.push(plan.id);
  return true;
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
  $("exerciseDialogTitle").textContent=ex?"Edit exercise":"Add exercise";$("exerciseId").value=ex?.id||"";$("exerciseName").value=ex?.name||"";$("exerciseCategory").value=ex?.category||"strength";$("exerciseMuscle").value=ex?.muscle||"";$("exerciseLink").value=ex?.link||"";$("exerciseNotes").value=ex?.notes||"";$("exercisePhoto").value="";
  exercisePhotoDraft=ex?.photo||"";exercisePhotoMessage="";updateExercisePhotoPreview();showDialog("exerciseDialog");
}
function populateAddWorkout(){
  const w=workoutFor(selectedDate,true),used=new Set(w.items.map(x=>x.exerciseId)),planSelect=$("availablePlansSelect"),exerciseSelect=$("availableExercisesSelect");
  planSelect.innerHTML="";
  if(!state.plans.length){const opt=new Option("No saved plans","");opt.disabled=true;planSelect.appendChild(opt)}
  else state.plans.forEach(p=>{const missing=planMissingItems(p,w),opt=new Option(planOptionLabel(p,w),p.id);opt.disabled=!(p.items||[]).length||missing.length===0;opt.dataset.missing=String(missing.length);planSelect.appendChild(opt)});
  const firstPlan=Array.from(planSelect.options).find(o=>!o.disabled&&o.value);if(firstPlan)planSelect.value=firstPlan.value;
  exerciseSelect.innerHTML=state.exercises.filter(x=>!x.archived&&["strength","cardio"].includes(x.category)&&!used.has(x.id)).map(x=>`<option value="${x.id}" data-category="${x.category}">${x.name}</option>`).join("")||'<option value="">No available exercise</option>';
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

document.querySelectorAll(".bottom-nav button").forEach(b=>b.onclick=()=>{document.querySelectorAll(".bottom-nav button").forEach(x=>x.classList.remove("active"));b.classList.add("active");document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));$(b.dataset.view).classList.add("active");renderAll()});
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeDialog(b.dataset.close));
document.querySelectorAll("dialog").forEach(d=>d.addEventListener("close",()=>{if(d.id==="addWorkoutDialog")resetAddWorkoutDialog();syncModalLock()}));
$("saveMetricsBtn").onclick=()=>{const weight=Number($("todayWeight").value),bodyFat=Number($("todayBodyFat").value);if(!weight||!bodyFat)return alert("Enter weight and body fat.");state.metrics[todayKey()]={weight,bodyFat};persist()};
$("previousWeekBtn").onclick=()=>{weekOffset--;renderWeek()};$("nextWeekBtn").onclick=()=>{weekOffset++;renderWeek()};$("backThisWeekBtn").onclick=()=>{weekOffset=0;selectedDate=todayKey();renderAll()};
$("openAddWorkoutBtn").onclick=()=>{resetAddWorkoutDialog();populateAddWorkout();setAddMode("plan");showDialog("addWorkoutDialog")};
document.querySelectorAll('input[name="addMode"]').forEach(r=>r.onchange=updateAddMode);$("availableExercisesSelect").onchange=updateQuickExerciseFields;$("addQuickCardioIntervalBtn").onclick=()=>{intervalDraft.push(intervalDraft.at(-1)||10);renderQuickIntervals()};
$("addWorkoutForm").onsubmit=e=>{e.preventDefault();const mode=document.querySelector('input[name="addMode"]:checked').value,w=workoutFor(selectedDate,true);if(mode==="plan"){const p=state.plans.find(x=>x.id===$("availablePlansSelect").value);if(!p)return alert("No plan available.");if(!addPlanToWorkout(p))return alert("This plan is already complete for this date.")}else{const id=$("availableExercisesSelect").value,ex=exById(id);if(!ex)return alert("No exercise available.");if(w.items.some(x=>x.exerciseId===id))return alert("Exercise already added.");if(ex.category==="cardio")w.items.push({id:crypto.randomUUID(),exerciseId:id,exerciseName:ex.name,category:"cardio",type:"cardio",intervals:intervalDraft.map(minutes=>({minutes,done:false})),targetHr:""});else w.items.push({id:crypto.randomUUID(),exerciseId:id,exerciseName:ex.name,category:"strength",type:"exercise",sets:Array.from({length:Number($("quickSets").value)||2},()=>({weight:0,reps:Number($("quickReps").value)||12,done:false}))})}closeDialog("addWorkoutDialog");persist()};
$("addExerciseBtn").onclick=()=>openExercise();
$("exercisePhoto").onchange=async e=>{const f=e.target.files[0];if(!f)return;exercisePhotoDraft=await fileToDataUrl(f);exercisePhotoMessage="New photo selected. Save to keep it.";updateExercisePhotoPreview()};
$("removeExercisePhotoBtn").onclick=()=>{exercisePhotoDraft="";exercisePhotoMessage="Photo will be removed when you Save. Choose Cancel to keep the old photo.";$("exercisePhoto").value="";updateExercisePhotoPreview()};
$("undoWorkoutRemoveBtn").onclick=()=>{if(pendingUndo)pendingUndo()};
$("exerciseForm").onsubmit=async e=>{e.preventDefault();const id=$("exerciseId").value,name=$("exerciseName").value.trim();if(!name)return;const exact=state.exercises.some(x=>x.id!==id&&normalizeName(x.name)===normalizeName(name));if(exact)return alert("This exercise already exists.");const similar=similarName(name,id);if(similar&&!confirm(`A similar exercise already exists: ${similar.name}\n\nSave anyway?`))return;const old=id?exById(id):null;if($("exercisePhoto").files[0]&&!exercisePhotoDraft)exercisePhotoDraft=await fileToDataUrl($("exercisePhoto").files[0]);const record={id:id||crypto.randomUUID(),name,category:$("exerciseCategory").value,muscle:$("exerciseMuscle").value.trim(),photo:exercisePhotoDraft,link:$("exerciseLink").value.trim(),notes:$("exerciseNotes").value.trim(),archived:old?.archived??false};if(id)state.exercises[state.exercises.findIndex(x=>x.id===id)]=record;else state.exercises.push(record);closeDialog("exerciseDialog");persist()};
$("librarySearch").oninput=renderLibrary;
$("addPlanBtn").onclick=()=>openPlan();$("planCategorySelect").onchange=()=>{populatePlanExerciseOptions();updatePlanFields();intervalDraft=[10,10];renderPlanIntervals()};$("addPlanCardioIntervalBtn").onclick=()=>{intervalDraft.push(intervalDraft.at(-1)||10);renderPlanIntervals()};$("addPlanItemInlineBtn").onclick=addCurrentPlanItem;
$("planForm").onsubmit=e=>{e.preventDefault();planDraft.name=$("planName").value.trim();planDraft.notes=$("planNotes").value.trim();if(!planDraft.name)return;planDraft.id=planDraft.id||crypto.randomUUID();const i=state.plans.findIndex(x=>x.id===planDraft.id);if(i>=0)state.plans[i]=structuredClone(planDraft);else state.plans.push(structuredClone(planDraft));closeDialog("planDialog");persist()};
$("exportBackupBtn").onclick=()=>downloadBackup(state);$("restoreBackupInput").onchange=async e=>{const f=e.target.files[0];if(!f)return;try{state=JSON.parse(await f.text());saveState(state);renderAll();alert("Backup restored.")}catch{alert("Invalid backup file.")}};$("clearDataBtn").onclick=()=>{if(confirm("Clear all local data?")){state=makeDefaultState();saveState(state);selectedDate=todayKey();weekOffset=0;renderAll()}};
if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
renderAll();
