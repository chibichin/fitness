import {loadState,saveState,makeDefaultState,downloadBackup,uid} from "./storage.js";
import {downloadTeacherWorkbook} from "./xlsx.js";

let state=loadState();
let selectedDate=todayKey();
let weekOffset=0;
let planDraft=null;
let intervalDraft=[10,10];
let addToIntervalDraft=[10,10];
let pendingWorkoutItemRemoval=null;
let exercisePhotoObjectUrl="";
let removeExercisePhotoRequested=false;
let addWorkoutPlanId="";
let addWorkoutPlanSelection=new Set();
let addWorkoutExerciseSelection=new Set();

const $=id=>document.getElementById(id);
const sections=["warmup","strength","cardio","flexibility"];
const labels={warmup:"Warm up",strength:"Strength",cardio:"Cardio",flexibility:"Flexibility"};
const muscleOptions=["Chest","Back","Shoulders","Biceps","Triceps","Forearms","Core","Quads","Hamstrings","Glutes","Calves","Hip flexors","Hips","Adductors","Abductors","Neck","Full body"];
const equipmentLabels={"":"Not specified","Bodyweight":"Bodyweight","Dumbbell":"Dumbbell","Barbell":"Barbell","Machine":"Machine","Cable":"Cable","Kettlebell":"Kettlebell","Resistance band":"Resistance band","Cardio machine":"Cardio machine","Other":"Other"};

function localDateKey(d=new Date()){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return `${y}-${m}-${day}`}
function todayKey(){return localDateKey(new Date())}
function keyFromDate(d){return localDateKey(d)}
function prettyDate(key){return new Intl.DateTimeFormat("en-US",{weekday:"long",month:"long",day:"numeric"}).format(new Date(key+"T12:00:00"))}
function exById(id){return state.exercises.find(x=>x.id===id)}
function planById(id){return state.plans.find(x=>x.id===id)}
function activeExercises(category){return state.exercises.filter(x=>!x.archived&&(!category||x.category===category))}
function itemCategory(item){return item.category||exById(item.exerciseId)?.category||"strength"}
function isDone(item){return item.type==="cardio"?(item.intervals?.length>0&&item.intervals.every(x=>x.done)):(item.sets?.length>0&&item.sets.every(x=>x.done))}
function persist(){saveState(state);renderAll()}
function workoutFor(key,create=false){if(!state.workouts[key]&&create){state.workouts[key]={date:key,planIds:[],items:[]};saveState(state)}return state.workouts[key]}
function normalizeName(s){return s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g,"")}
function similarName(name,id=""){const n=normalizeName(name);return state.exercises.find(x=>x.id!==id&&(normalizeName(x.name)===n||normalizeName(x.name).includes(n)||n.includes(normalizeName(x.name))))}
function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)})}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]))}
function splitList(value){return (Array.isArray(value)?value:String(value||"").split(/[,;/]+/)).map(x=>String(x).trim()).filter(Boolean)}
function uniqueList(values){const seen=new Set();return splitList(values).filter(value=>{const key=value.toLowerCase();if(seen.has(key))return false;seen.add(key);return true})}
function initializeChoiceGroup(containerId){
  const container=$(containerId);if(container.dataset.ready)return;
  for(const muscle of muscleOptions){
    const label=document.createElement("label");label.className="choice-chip";
    const input=document.createElement("input");input.type="checkbox";input.value=muscle;
    const text=document.createElement("span");text.textContent=muscle;
    label.append(input,text);container.appendChild(label);
  }
  container.dataset.ready="true";
}
function setChoiceValues(containerId,customId,values){
  initializeChoiceGroup(containerId);const selected=uniqueList(values),known=new Set(muscleOptions.map(x=>x.toLowerCase()));
  $(containerId).querySelectorAll('input[type="checkbox"]').forEach(input=>input.checked=selected.some(value=>value.toLowerCase()===input.value.toLowerCase()));
  $(customId).value=selected.filter(value=>!known.has(value.toLowerCase())).join(", ");
}
function readChoiceValues(containerId,customId){
  const checked=[...$(containerId).querySelectorAll('input[type="checkbox"]:checked')].map(input=>input.value);
  return uniqueList([...checked,...splitList($(customId).value)]);
}
function exercisePrimaryMuscles(ex){return uniqueList(ex?.primaryMuscles?.length?ex.primaryMuscles:ex?.muscle)}
function exerciseSecondaryMuscles(ex){const primary=new Set(exercisePrimaryMuscles(ex).map(x=>x.toLowerCase()));return uniqueList(ex?.secondaryMuscles).filter(x=>!primary.has(x.toLowerCase()))}
function calculateMuscleFocus(exercises){
  const scores=new Map(),names=new Map();
  const add=(name,points)=>{const clean=String(name||"").trim();if(!clean)return;const key=clean.toLowerCase();names.set(key,names.get(key)||clean);scores.set(key,(scores.get(key)||0)+points)};
  for(const ex of exercises.filter(Boolean)){exercisePrimaryMuscles(ex).forEach(name=>add(name,2));exerciseSecondaryMuscles(ex).forEach(name=>add(name,1))}
  const ranked=[...scores].map(([key,score])=>({name:names.get(key),score})).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
  if(!ranked.length)return {main:[],also:[],ranked:[]};
  const threshold=Math.max(2,ranked[0].score*.6);let main=ranked.filter(entry=>entry.score>=threshold).slice(0,5);
  if(!main.length)main=ranked.slice(0,Math.min(3,ranked.length));
  const mainKeys=new Set(main.map(entry=>entry.name.toLowerCase()));
  return {main:main.map(entry=>entry.name),also:ranked.filter(entry=>!mainKeys.has(entry.name.toLowerCase())).slice(0,8).map(entry=>entry.name),ranked};
}
function muscleChipsHtml(values,primary=false){return `<div class="muscle-chips">${uniqueList(values).map(value=>`<span class="muscle-chip${primary?" primary":""}">${escapeHtml(value)}</span>`).join("")}</div>`}
function focusSummaryHtml({intended=[],main=[],also=[]}){
  const rows=[];
  if(intended.length)rows.push(`<div class="focus-row"><span class="focus-label">Intended focus</span>${muscleChipsHtml(intended,true)}</div>`);
  if(main.length)rows.push(`<div class="focus-row"><span class="focus-label">Calculated main focus</span>${muscleChipsHtml(main,true)}</div>`);
  if(also.length)rows.push(`<div class="focus-row"><span class="focus-label">Also involved</span>${muscleChipsHtml(also)}</div>`);
  return rows.join("");
}
function exerciseMetaHtml(ex){
  const primary=exercisePrimaryMuscles(ex),secondary=exerciseSecondaryMuscles(ex),rows=[];
  if(primary.length)rows.push(`<div class="exercise-meta-line"><b>Primary:</b>${escapeHtml(primary.join(", "))}</div>`);
  if(secondary.length)rows.push(`<div class="exercise-meta-line"><b>Secondary:</b>${escapeHtml(secondary.join(", "))}</div>`);
  const details=[ex?.equipment&&equipmentLabels[ex.equipment]||ex?.equipment,ex?.movementType].filter(Boolean);
  if(details.length)rows.push(`<div class="exercise-meta-line"><b>Setup:</b>${escapeHtml(details.join(" · "))}</div>`);
  return rows.join("");
}
function exercisesFromItems(items){return (items||[]).map(item=>exById(item.exerciseId)).filter(Boolean)}

// Shared session/plan helpers. Fitness-specific fields stay inside these builders.
function previousTrackingValues(activityId,beforeDate){
  const dates=Object.keys(state.workouts).filter(key=>key<beforeDate).sort().reverse();
  for(const date of dates){
    const item=[...(state.workouts[date]?.items||[])].reverse().find(x=>x.exerciseId===activityId&&x.type!=="cardio");
    if(!item)continue;
    const raw=(item.sets||[]).map(set=>Number(set?.weight)||0),valid=raw.filter(weight=>weight>0);
    if(!valid.length)continue;
    const lastWeight=valid.at(-1);
    return {date,weights:raw.map(weight=>weight>0?weight:lastWeight),lastWeight};
  }
  return null;
}
function trackingDefaults(ex){
  if(ex?.category==="strength")return {sets:2,reps:12};
  if(ex?.category==="flexibility")return {sets:1,reps:30};
  if(ex?.category==="warmup")return {sets:1,reps:6};
  return {sets:1,reps:12};
}
function createPlanItem(ex,options={}){
  if(ex.category==="cardio")return {id:uid(),exerciseId:ex.id,exerciseName:ex.name,category:ex.category,type:"cardio",intervals:[...(options.intervals||[10])]};
  const defaults=trackingDefaults(ex);
  return {id:uid(),exerciseId:ex.id,exerciseName:ex.name,category:ex.category,type:"exercise",sets:Number(options.sets)||defaults.sets,reps:Number(options.reps)||defaults.reps};
}
function createSessionItem(ex,options={},date=todayKey(),sourceInfo={}){
  if(ex.category==="cardio")return {id:uid(),exerciseId:ex.id,exerciseName:ex.name,category:ex.category,type:"cardio",intervals:(options.intervals||[10]).map(value=>({minutes:Number(typeof value==="number"?value:value?.minutes)||10,targetHr:"",done:false})),...sourceInfo};
  const defaults=trackingDefaults(ex),count=Math.max(1,Number(options.sets)||defaults.sets),reps=Number(options.reps)||defaults.reps;
  const previous=ex.category==="strength"?previousTrackingValues(ex.id,date):null;
  const sets=Array.from({length:count},(_,index)=>({weight:previous?.weights[index]??previous?.lastWeight??0,reps,done:false}));
  return {id:uid(),exerciseId:ex.id,exerciseName:ex.name,category:ex.category,type:"exercise",sets,...sourceInfo};
}
function addActivityToSession(ex,date,options={},sourceInfo={}){
  const session=workoutFor(date,true);
  if(session.items.some(item=>item.exerciseId===ex.id))return false;
  session.items.push(createSessionItem(ex,options,date,sourceInfo));
  return true;
}
function previousWeightText(ex,date){
  if(ex?.category!=="strength")return "";
  const previous=previousTrackingValues(ex.id,date);
  return previous?`Last used ${previous.lastWeight} lb on ${previous.date}. Weight will be prefilled.`:"";
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
  const atToday=weekOffset===0&&selectedDate===todayKey();
  $("backThisWeekBtn").classList.toggle("invisible",atToday);
  $("backThisWeekBtn").setAttribute("aria-hidden",String(atToday));
  $("backThisWeekBtn").tabIndex=atToday?-1:0;
}
function workoutGroups(w){
  const groups=[],lookup=new Map();
  for(const item of w.items){
    const category=itemCategory(item),isPlanItem=Boolean(item.sourcePlanId),key=isPlanItem?`plan:${item.sourcePlanId}`:`category:${category}`;
    if(!lookup.has(key)){
      const plan=isPlanItem?planById(item.sourcePlanId):null;
      const group={key,title:isPlanItem?(plan?.name||item.sourcePlanName||"Plan"):labels[category],items:[]};
      lookup.set(key,group);groups.push(group);
    }
    lookup.get(key).items.push(item);
  }
  return groups;
}
function renderTodayMuscleFocus(w){
  const host=$("todayMuscleFocus");
  if(!w?.items?.length){host.innerHTML="";host.classList.add("hidden");return}
  const summary=calculateMuscleFocus(exercisesFromItems(w.items));
  const html=focusSummaryHtml({main:summary.main,also:summary.also});
  host.innerHTML=html;host.classList.toggle("hidden",!html);
}
function renderWorkout(){
  const host=$("workoutSections"),w=workoutFor(selectedDate);host.innerHTML="";renderTodayMuscleFocus(w);
  if(!w?.items?.length){host.innerHTML='<p class="muted">No workout planned for this date.</p>';return}
  for(const group of workoutGroups(w)){
    const entries=group.items,doneCount=entries.filter(isDone).length;
    const section=document.createElement("section");section.className="workout-section";
    const header=document.createElement("button");header.className="workout-section-header";
    header.innerHTML=`<span><b>${group.title}</b><small>${doneCount}/${entries.length} complete</small></span><b>⌄</b>`;
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
function closeItemMenus(except=null){document.querySelectorAll(".item-menu").forEach(menu=>{if(menu!==except){menu.classList.add("hidden");menu.closest(".workout-item")?.querySelector(".more")?.setAttribute("aria-expanded","false")}})}
function openRemoveWorkoutItem(item){
  pendingWorkoutItemRemoval={date:selectedDate,itemId:item.id};
  const ex=exById(item.exerciseId),name=ex?.name||item.exerciseName||"this exercise",plan=item.sourcePlanId?(planById(item.sourcePlanId)?.name||item.sourcePlanName):"";
  $("removeWorkoutItemMessage").textContent=plan?`Remove ${name} from “${plan}”?`:`Remove ${name} from this workout?`;
  showDialog("removeWorkoutItemDialog");
  requestAnimationFrame(()=>$("cancelRemoveWorkoutItemBtn").focus());
}
function renderWorkoutItem(item){
  const ex=exById(item.exerciseId),displayName=ex?.name||item.exerciseName||"Exercise",card=document.createElement("div");card.className="workout-item"+(isDone(item)?" completed":"");
  const setActions=item.type==="cardio"?"":'<button class="secondary add-set-action" type="button">Add set</button><button class="secondary remove-set-action" type="button">Remove last set</button>';
  card.innerHTML=`<div class="item-head"><div><strong>${escapeHtml(displayName)}</strong><div class="muted">${labels[itemCategory(item)]}</div></div><div class="item-actions"><button class="secondary reference" type="button">Ref</button><button class="secondary more" type="button" aria-label="Exercise actions" aria-expanded="false">⋯</button></div></div><div class="item-menu hidden">${setActions}<button class="danger remove-exercise-action" type="button">Remove exercise</button></div><div class="item-body"></div>`;
  const menu=card.querySelector(".item-menu"),more=card.querySelector(".more");
  more.onclick=e=>{e.stopPropagation();const willOpen=menu.classList.contains("hidden");closeItemMenus(menu);menu.classList.toggle("hidden",!willOpen);more.setAttribute("aria-expanded",String(willOpen))};
  menu.onclick=e=>e.stopPropagation();
  card.querySelector(".remove-exercise-action").onclick=()=>{closeItemMenus();openRemoveWorkoutItem(item)};
  const addSetButton=card.querySelector(".add-set-action"),removeSetButton=card.querySelector(".remove-set-action");
  if(addSetButton){
    removeSetButton.disabled=(item.sets||[]).length<=1;
    addSetButton.onclick=()=>{const last=item.sets.at(-1)||{weight:0,reps:12};item.sets.push({weight:last.weight,reps:last.reps,done:false});closeItemMenus();persist()};
    removeSetButton.onclick=()=>{if(item.sets.length>1){item.sets.pop();closeItemMenus();persist()}};
  }
  card.querySelector(".reference").onclick=()=>showReference(ex);
  const body=card.querySelector(".item-body");
  if(item.type==="cardio"){
    item.intervals ||= [{minutes:10,targetHr:"",done:false}];
    item.intervals.forEach((interval,index)=>{
      interval.targetHr ??= "";
      const row=document.createElement("div");row.className="set-row cardio-interval-row";
      row.innerHTML=`<div class="unit-input"><input type="number" min="1" value="${interval.minutes}" aria-label="Interval ${index+1} minutes"><b>min</b></div><input inputmode="numeric" placeholder="Heart rate" value="${interval.targetHr}" aria-label="Interval ${index+1} heart rate"><button class="${interval.done?"":"secondary"}" aria-label="Mark interval ${index+1} ${interval.done?"not done":"done"}">${interval.done?"✓":"○"}</button><button class="secondary remove-interval" type="button" aria-label="Remove interval ${index+1}" ${item.intervals.length<=1?"disabled":""}>−</button>`;
      row.children[0].querySelector("input").onchange=e=>{interval.minutes=Number(e.target.value)||1;saveState(state)};
      row.children[1].onchange=e=>{interval.targetHr=e.target.value;saveState(state)};
      row.children[2].onclick=()=>{interval.done=!interval.done;persist()};
      row.children[3].onclick=()=>{if(item.intervals.length>1){item.intervals.splice(index,1);persist()}};
      body.appendChild(row);
    });
    const controls=document.createElement("div");controls.className="cardio-controls";
    controls.innerHTML='<button type="button" class="secondary full">＋ Add interval</button>';
    controls.firstChild.onclick=()=>{const last=item.intervals.at(-1)||{minutes:10};item.intervals.push({minutes:last.minutes||10,targetHr:"",done:false});persist()};
    body.appendChild(controls);
  }else{
    item.sets.forEach(set=>{
      const row=document.createElement("div");row.className="set-row strength-set-row";
      row.innerHTML=`<div class="stepper-field"><span>Reps</span><div class="number-stepper"><button type="button" class="secondary reps-minus" aria-label="Decrease reps by 2">−</button><input type="number" min="0" step="1" value="${set.reps||0}" aria-label="Reps"><button type="button" class="secondary reps-plus" aria-label="Increase reps by 2">＋</button></div></div><div class="stepper-field"><span>Weight (lb)</span><div class="number-stepper"><button type="button" class="secondary weight-minus" aria-label="Decrease weight by 2.5 pounds">−</button><input type="number" min="0" step="0.5" value="${set.weight||0}" aria-label="Weight"><button type="button" class="secondary weight-plus" aria-label="Increase weight by 2.5 pounds">＋</button></div></div><button class="${set.done?"":"secondary"} set-done" aria-label="Mark set ${set.done?"not done":"done"}">${set.done?"✓":"○"}</button>`;
      const repsInput=row.querySelector('input[aria-label="Reps"]'),weightInput=row.querySelector('input[aria-label="Weight"]');
      const adjust=(key,delta,input)=>{const next=Math.max(0,Math.round(((Number(set[key])||0)+delta)*100)/100);set[key]=next;input.value=String(next);saveState(state)};
      repsInput.onchange=e=>{set.reps=Math.max(0,Number(e.target.value)||0);e.target.value=String(set.reps);saveState(state)};
      weightInput.onchange=e=>{set.weight=Math.max(0,Number(e.target.value)||0);e.target.value=String(set.weight);saveState(state)};
      row.querySelector(".reps-minus").onclick=()=>adjust("reps",-2,repsInput);row.querySelector(".reps-plus").onclick=()=>adjust("reps",2,repsInput);
      row.querySelector(".weight-minus").onclick=()=>adjust("weight",-2.5,weightInput);row.querySelector(".weight-plus").onclick=()=>adjust("weight",2.5,weightInput);
      row.querySelector(".set-done").onclick=()=>{set.done=!set.done;persist()};
      body.appendChild(row);
    });
  }
  return card;
}
function showReference(ex){
  $("referenceTitle").textContent=ex?.name||"Reference";
  $("referenceImage").classList.toggle("hidden",!ex?.photo);$("referenceImage").src=ex?.photo||"";
  const meta=exerciseMetaHtml(ex);$("referenceMuscleMeta").innerHTML=meta;$("referenceMuscleMeta").classList.toggle("hidden",!meta);
  $("referenceNotes").classList.toggle("hidden",!ex?.notes);$("referenceNotes").textContent=ex?.notes||"";
  $("referenceLink").classList.toggle("hidden",!ex?.link);$("referenceLink").href=ex?.link||"#";
  $("referenceEmpty").classList.toggle("hidden",Boolean(ex?.photo||meta||ex?.notes||ex?.link));
  showDialog("referenceDialog");
}

function renderPlans(){
  const host=$("plansList");
  if(!state.plans.length){host.innerHTML='<article class="card"><p class="muted">No plans yet.</p></article>';return}
  host.innerHTML=state.plans.map(p=>{
    const count=(p.items||[]).length,summary=calculateMuscleFocus(exercisesFromItems(p.items));
    const focus=focusSummaryHtml({main:summary.main,also:summary.also});
    return `<article class="list-card"><strong>${escapeHtml(p.name)}</strong>${p.notes?`<p class="muted plan-notes">${escapeHtml(p.notes)}</p>`:'<p class="muted plan-notes">No notes</p>'}${focus?`<div class="plan-focus-inline">${focus}</div>`:'<p class="muted">No muscle details</p>'}<p class="plan-exercise-count">${count} exercise${count===1?"":"s"}</p><div class="actions"><button class="secondary edit-plan" data-id="${p.id}">Edit</button><button class="secondary duplicate-plan" data-id="${p.id}">Duplicate</button><button class="danger delete-plan" data-id="${p.id}">Delete</button></div></article>`;
  }).join("");
  host.querySelectorAll(".edit-plan").forEach(b=>b.onclick=()=>openPlan(state.plans.find(x=>x.id===b.dataset.id)));
  host.querySelectorAll(".duplicate-plan").forEach(b=>b.onclick=()=>{const p=structuredClone(state.plans.find(x=>x.id===b.dataset.id));p.id=uid();p.name+=" Copy";state.plans.push(p);persist()});
  host.querySelectorAll(".delete-plan").forEach(b=>b.onclick=()=>{if(confirm("Delete this plan?")){state.plans=state.plans.filter(x=>x.id!==b.dataset.id);persist()}});
}
function openPlan(plan=null){
  planDraft=plan?structuredClone(plan):{id:"",name:"",notes:"",intendedFocus:[],items:[]};
  planDraft.items ||= [];planDraft.intendedFocus ||= [];
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
function renderPlanCalculatedFocus(){
  const host=$("planCalculatedFocus"),summary=calculateMuscleFocus(exercisesFromItems(planDraft?.items||[]));
  const html=focusSummaryHtml({main:summary.main,also:summary.also});
  host.innerHTML=html;host.classList.toggle("hidden",!html);
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
  renderPlanCalculatedFocus();
}
function addCurrentPlanItem(){
  const id=$("planExerciseSelect").value,ex=exById(id);if(!ex)return alert("No exercise available.");if(planDraft.items.some(x=>x.exerciseId===id))return alert("Exercise already added.");
  const options=ex.category==="cardio"?{intervals:[...intervalDraft]}:{sets:Number($("planSets").value)||1,reps:Number($("planReps").value)||1};
  planDraft.items.push(createPlanItem(ex,options));intervalDraft=[10,10];renderPlanDraft();populatePlanExerciseOptions();renderPlanIntervals();
}
function addPlanToWorkout(plan,selectedItemIds=null){
  const w=workoutFor(selectedDate,true),used=new Set(w.items.map(x=>x.exerciseId)),source=(plan.items||[]).filter(x=>!used.has(x.exerciseId)&&(!selectedItemIds||selectedItemIds.has(x.id)));
  for(const item of source){
    const ex=exById(item.exerciseId)||{id:item.exerciseId,name:item.exerciseName||"Exercise",category:item.category||"strength"};
    const options=item.type==="cardio"?{intervals:item.intervals||[10]}:{sets:item.sets||1,reps:item.reps||1};
    const sourceInfo={sourcePlanId:plan.id,sourcePlanName:plan.name,sourcePlanItemId:item.id};
    w.items.push(createSessionItem(ex,options,selectedDate,sourceInfo));
  }
  if(!w.planIds.includes(plan.id))w.planIds.push(plan.id);
  return source.length;
}

function addToFormOptions(ex){
  if(ex.category==="cardio")return {intervals:[...addToIntervalDraft]};
  return {sets:Number($("addToSets").value)||1,reps:Number($("addToReps").value)||1};
}
function renderAddToIntervals(){
  $("addToCardioIntervals").innerHTML=addToIntervalDraft.map((minutes,index)=>`<div class="set-row"><div class="unit-input"><input data-i="${index}" type="number" min="1" value="${minutes}"><b>min</b></div><span></span><button type="button" class="secondary remove-add-to-interval" data-i="${index}" ${addToIntervalDraft.length<=1?"disabled":""}>×</button></div>`).join("");
  $("addToCardioIntervals").querySelectorAll("input").forEach(input=>input.onchange=event=>addToIntervalDraft[Number(event.target.dataset.i)]=Number(event.target.value)||1);
  $("addToCardioIntervals").querySelectorAll(".remove-add-to-interval").forEach(button=>button.onclick=()=>{if(addToIntervalDraft.length>1){addToIntervalDraft.splice(Number(button.dataset.i),1);renderAddToIntervals()}});
}
function populateAddToPlans(ex){
  const select=$("addToPlanSelect");select.innerHTML="";let firstEnabled=null;
  for(const plan of state.plans){
    const option=document.createElement("option"),added=(plan.items||[]).some(item=>item.exerciseId===ex.id);
    option.value=plan.id;option.textContent=added?`✓ ${plan.name} — Added`:plan.name;option.disabled=added;
    if(!added&&!firstEnabled)firstEnabled=option;
    select.appendChild(option);
  }
  if(!state.plans.length){const option=document.createElement("option");option.value="";option.textContent="No saved plans";option.disabled=true;option.selected=true;select.appendChild(option)}
  else if(!firstEnabled){const option=document.createElement("option");option.value="";option.textContent="Already added to every plan";option.disabled=true;option.selected=true;select.prepend(option)}
  else firstEnabled.selected=true;
}
function selectedAddToTarget(){return document.querySelector('input[name="addToTarget"]:checked')?.value||"today"}
function updateAddToTarget(){
  const target=selectedAddToTarget();
  $("addToExistingPlanPanel").classList.toggle("hidden",target!=="existing-plan");
  $("addToNewPlanPanel").classList.toggle("hidden",target!=="new-plan");
  updateAddToStatus();
}
function updateAddToStatus(){
  const ex=exById($("addToExerciseId").value),target=selectedAddToTarget(),status=$("addToStatus"),button=$("confirmAddToBtn");
  let message="",disabled=!ex;
  if(ex&&target==="today"){
    const added=workoutFor(todayKey())?.items?.some(item=>item.exerciseId===ex.id);
    if(added){message="Already in today’s workout.";disabled=true}else message="This will be added to today’s workout.";
  }else if(ex&&target==="existing-plan"){
    const plan=planById($("addToPlanSelect").value);
    if(!plan){message="No available plan.";disabled=true}
    else if((plan.items||[]).some(item=>item.exerciseId===ex.id)){message="Already in this plan.";disabled=true}
    else message=`This will be added to “${plan.name}”.`;
  }else if(ex&&target==="new-plan"){
    const name=$("addToNewPlanName").value.trim();
    message=name?`A new plan named “${name}” will be created.`:"Enter a name for the new plan.";
    disabled=!name;
  }
  status.textContent=message;button.disabled=disabled;
}
function openAddTo(ex){
  if(!ex)return;
  $("addToForm").reset();$("addToExerciseId").value=ex.id;$("addToExerciseName").textContent=ex.name;$("addToTodayLabel").textContent=prettyDate(todayKey());
  document.querySelector('input[name="addToTarget"][value="today"]').checked=true;
  const defaults=trackingDefaults(ex);$("addToSets").value=defaults.sets;$("addToReps").value=defaults.reps;
  addToIntervalDraft=[10,10];renderAddToIntervals();populateAddToPlans(ex);
  const isCardio=ex.category==="cardio";$("addToStrengthFields").classList.toggle("hidden",isCardio);$("addToCardioFields").classList.toggle("hidden",!isCardio);
  const hint=previousWeightText(ex,todayKey());$("addToPreviousWeightHint").textContent=hint;$("addToPreviousWeightHint").classList.toggle("hidden",!hint);
  $("addToNewPlanName").value=`${ex.name} Plan`;updateAddToTarget();showDialog("addToDialog");
}

function renderLibrary(){
  const q=$("librarySearch").value.trim().toLowerCase(),host=$("libraryList");host.innerHTML="";
  for(const category of sections){
    const list=activeExercises(category).filter(ex=>{
      const searchable=[ex.name,ex.notes,ex.equipment,ex.movementType,...exercisePrimaryMuscles(ex),...exerciseSecondaryMuscles(ex)].join(" ").toLowerCase();
      return searchable.includes(q);
    });
    if(!list.length)continue;
    const sec=document.createElement("section");sec.className="library-section";sec.innerHTML=`<h3>${labels[category]} (${list.length})</h3>`;
    for(const ex of list){const card=document.createElement("article");card.className="list-card";const meta=exerciseMetaHtml(ex);
      card.innerHTML=`<strong>${escapeHtml(ex.name)}</strong>${meta?`<div class="exercise-meta">${meta}</div>`:'<p class="muted">No muscle details</p>'}${ex.photo?`<img src="${ex.photo}" class="reference-photo" alt="">`:""}${ex.notes?`<p>${escapeHtml(ex.notes)}</p>`:""}${ex.link?`<a href="${escapeHtml(ex.link)}" target="_blank" rel="noopener">Open reference</a>`:""}<div class="actions library-actions"><button class="add-to-exercise">Add to…</button><button class="secondary edit-exercise">Edit</button><button class="danger delete-exercise">Delete</button></div>`;
      card.querySelector(".add-to-exercise").onclick=()=>openAddTo(ex);
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


// Teacher weekly spreadsheet export. The workbook keeps the teacher's
// exercise / sets-reps / date-column arrangement and landscape Letter setup.
function dateFromKey(key){return new Date(`${key}T12:00:00`)}
function teacherWeekKeys(containingDate){
  const base=dateFromKey(containingDate),start=new Date(base);start.setDate(base.getDate()-base.getDay());
  return Array.from({length:7},(_,index)=>{const day=new Date(start);day.setDate(start.getDate()+index);return keyFromDate(day)});
}
function teacherWorkoutDates(containingDate){return teacherWeekKeys(containingDate).filter(key=>(state.workouts[key]?.items||[]).length)}
function teacherItemKey(item){return item.exerciseId||`name:${normalizeName(item.exerciseName||"Exercise")}`}
function teacherRows(dates,category){
  const rows=new Map();
  dates.forEach(date=>{
    (state.workouts[date]?.items||[]).filter(item=>itemCategory(item)===category).forEach(item=>{
      const key=teacherItemKey(item);
      if(!rows.has(key))rows.set(key,{key,name:exById(item.exerciseId)?.name||item.exerciseName||"Exercise",byDate:{},latestDate:"",latest:null});
      const row=rows.get(key);row.byDate[date]=item;
      if(!row.latestDate||date>=row.latestDate){row.latestDate=date;row.latest=item}
    });
  });
  return [...rows.values()];
}
function teacherSetsReps(item){
  const sets=item?.sets||[];
  if(!sets.length)return "";
  const reps=sets.map(set=>Number(set.reps)||0),positive=reps.filter(Boolean);
  if(!positive.length)return `${sets.length}`;
  const same=positive.every(value=>value===positive[0]);
  if(sets.length===1)return `${positive[0]}`;
  if(same)return `${sets.length}x${positive[0]}`;
  return `${sets.length}x${Math.min(...positive)}-${Math.max(...positive)}`;
}
function teacherExportWeight(item){
  const sets=[...(item?.sets||[])].reverse();
  const completed=sets.find(set=>set.done&&Number(set.weight)>0);
  const recorded=sets.find(set=>Number(set.weight)>0);
  return Number((completed||recorded)?.weight)||"";
}
function teacherCompletedMark(item){return item&&isDone(item)?"X":""}
function teacherCardioForDate(date){
  const items=(state.workouts[date]?.items||[]).filter(item=>itemCategory(item)==="cardio");
  if(!items.length)return {name:"",minutes:"",heartRate:""};
  const intervals=items.flatMap(item=>{
    const all=item.intervals||[],completed=all.filter(interval=>interval.done);
    return completed.length?completed:all;
  });
  const minutes=intervals.reduce((sum,interval)=>sum+(Number(interval.minutes)||0),0);
  const hrText=intervals.map(interval=>String(interval.targetHr||"").trim()).filter(Boolean);
  const numbers=hrText.flatMap(value=>value.match(/\d+(?:\.\d+)?/g)||[]).map(Number).filter(Number.isFinite);
  let heartRate="";
  if(numbers.length){const low=Math.min(...numbers),high=Math.max(...numbers);heartRate=low===high?low:`${low}-${high}`}
  else heartRate=[...new Set(hrText)].join("/");
  return {name:items.map(item=>exById(item.exerciseId)?.name||item.exerciseName||"Cardio").join("/"),minutes:minutes||"",heartRate};
}
function teacherDateLabel(key){const date=dateFromKey(key);return `${date.getMonth()+1}/${date.getDate()}`}
function teacherReportRow(row,dates,valueForDate){
  return {name:row.name,detail:teacherSetsReps(row.latest),values:dates.map(date=>valueForDate(row.byDate[date]))};
}
function buildTeacherSpreadsheetReport({student,goals,containingDate}){
  const dates=teacherWorkoutDates(containingDate),week=teacherWeekKeys(containingDate);
  if(!dates.length)return {dates:[],pages:[]};
  const warm=teacherRows(dates,"warmup"),strength=teacherRows(dates,"strength"),flexibility=teacherRows(dates,"flexibility");
  const capacities={warmup:11,strength:12,flexibility:3};
  const pageCount=Math.max(1,Math.ceil(warm.length/capacities.warmup),Math.ceil(strength.length/capacities.strength),Math.ceil(flexibility.length/capacities.flexibility));
  const cardioByDate=dates.map(teacherCardioForDate);
  const pages=Array.from({length:pageCount},(_,pageIndex)=>({
    warmup:warm.slice(pageIndex*capacities.warmup,(pageIndex+1)*capacities.warmup).map(row=>teacherReportRow(row,dates,teacherCompletedMark)),
    strength:strength.slice(pageIndex*capacities.strength,(pageIndex+1)*capacities.strength).map(row=>teacherReportRow(row,dates,teacherExportWeight)),
    cardio:pageIndex===0?{
      names:cardioByDate.map(item=>item.name),
      heartRates:cardioByDate.map(item=>item.heartRate),
      minutes:cardioByDate.map(item=>item.minutes)
    }:{names:[],heartRates:[],minutes:[]},
    flexibility:flexibility.slice(pageIndex*capacities.flexibility,(pageIndex+1)*capacities.flexibility).map(row=>teacherReportRow(row,dates,teacherCompletedMark))
  }));
  return {
    student,goals,weekStart:week[0],weekLabel:`${teacherDateLabel(week[0])} - ${teacherDateLabel(week[6])}`,
    dates:dates.map(key=>({key,label:teacherDateLabel(key)})),pages
  };
}
function updateTeacherExportStatus(){
  const key=$("teacherWeekDate").value||selectedDate,dates=teacherWorkoutDates(key),status=$("teacherExportStatus");
  status.textContent=dates.length?`${dates.length} workout date${dates.length===1?"":"s"} will be exported: ${dates.map(teacherDateLabel).join(", ")}.`:"No workout records in this week.";
}
function openTeacherExport(){
  const saved=state.settings.teacherExport||{};
  $("teacherStudentName").value=saved.student||"";$("teacherGoals").value=saved.goals||"";$("teacherWeekDate").value=selectedDate;
  updateTeacherExportStatus();showDialog("teacherExportDialog");
}

function renderAll(){renderHeader();renderWeek();renderWorkout();renderPlans();renderLibrary();renderProgress()}

function clearExercisePhotoObjectUrl(){if(exercisePhotoObjectUrl){URL.revokeObjectURL(exercisePhotoObjectUrl);exercisePhotoObjectUrl=""}}
function showExercisePhotoPreview(src=""){$("exercisePhotoPreview").src=src;$("exercisePhotoPreviewWrap").classList.toggle("hidden",!src)}
function openExercise(ex=null){
  clearExercisePhotoObjectUrl();removeExercisePhotoRequested=false;
  $("exerciseDialogTitle").textContent=ex?"Edit exercise":"Add exercise";$("exerciseId").value=ex?.id||"";$("exerciseName").value=ex?.name||"";$("exerciseCategory").value=ex?.category||"strength";
  setChoiceValues("exercisePrimaryMuscles","exercisePrimaryCustom",exercisePrimaryMuscles(ex));setChoiceValues("exerciseSecondaryMuscles","exerciseSecondaryCustom",exerciseSecondaryMuscles(ex));
  $("exerciseEquipment").value=ex?.equipment||"";$("exerciseMovementType").value=ex?.movementType||"";$("exerciseLink").value=ex?.link||"";$("exerciseNotes").value=ex?.notes||"";$("exercisePhoto").value="";showExercisePhotoPreview(ex?.photo||"");showDialog("exerciseDialog");
}
function workoutUsedExerciseIds(){return new Set((workoutFor(selectedDate)?.items||[]).map(item=>item.exerciseId))}
function availablePlanItems(plan,used=workoutUsedExerciseIds()){return (plan?.items||[]).filter(item=>!used.has(item.exerciseId))}
function availableLibraryExercises(){const used=workoutUsedExerciseIds();return state.exercises.filter(ex=>!ex.archived&&!used.has(ex.id))}
function selectionOptionHtml({value,name,detail,checked=false,disabled=false,kind}){
  return `<label class="selection-option${disabled?" disabled":""}"><input type="${kind==="plan"?"radio":"checkbox"}" ${kind==="plan"?'name="addWorkoutPlan"':""} value="${escapeHtml(value)}" ${checked?"checked":""} ${disabled?"disabled":""}><span><b>${escapeHtml(name)}</b><small>${escapeHtml(detail)}</small></span></label>`;
}
function renderAvailablePlans(){
  const host=$("availablePlansList"),used=workoutUsedExerciseIds();
  if(!state.plans.length){host.innerHTML='<p class="empty-selection muted">No saved plans.</p>';return}
  host.innerHTML=state.plans.map(plan=>{
    const total=(plan.items||[]).length,available=availablePlanItems(plan,used).length,disabled=!available;
    const detail=!total?"Empty plan":disabled?"All exercises added":`${available} exercise${available===1?"":"s"} available`;
    return selectionOptionHtml({value:plan.id,name:plan.name,detail,checked:plan.id===addWorkoutPlanId,disabled,kind:"plan"});
  }).join("");
  host.querySelectorAll('input[name="addWorkoutPlan"]').forEach(input=>input.onchange=()=>{addWorkoutPlanId=input.value;addWorkoutPlanSelection=new Set(availablePlanItems(planById(input.value)).map(item=>item.id));renderAvailablePlanExercises();updateAddWorkoutSelectionStatus()});
}
function renderAvailablePlanExercises(){
  const host=$("availablePlanExercises"),plan=planById(addWorkoutPlanId),available=availablePlanItems(plan);
  if(!plan){host.innerHTML='<p class="empty-selection muted">All saved plan exercises are already in this workout.</p>';return}
  host.innerHTML=`<div class="selection-toolbar"><b>${escapeHtml(plan.name)}</b><button id="togglePlanExercisesBtn" type="button" class="secondary compact-button">${available.every(item=>addWorkoutPlanSelection.has(item.id))?"Clear all":"Select all"}</button></div>${available.map(item=>{
    const ex=exById(item.exerciseId),detail=item.type==="cardio"?`${(item.intervals||[]).join(" / ")} min`:`${item.sets||1} × ${item.reps||1} · ${labels[item.category||ex?.category||"strength"]}`;
    return selectionOptionHtml({value:item.id,name:ex?.name||item.exerciseName||"Exercise",detail,checked:addWorkoutPlanSelection.has(item.id),kind:"exercise"});
  }).join("")}`;
  host.querySelectorAll('input[type="checkbox"]').forEach(input=>input.onchange=()=>{if(input.checked)addWorkoutPlanSelection.add(input.value);else addWorkoutPlanSelection.delete(input.value);renderAvailablePlanExercises();updateAddWorkoutSelectionStatus()});
  const toggle=$("togglePlanExercisesBtn");if(toggle)toggle.onclick=()=>{const allSelected=available.every(item=>addWorkoutPlanSelection.has(item.id));addWorkoutPlanSelection=allSelected?new Set():new Set(available.map(item=>item.id));renderAvailablePlanExercises();updateAddWorkoutSelectionStatus()};
}
function filteredAvailableExercises(){
  const query=$("addWorkoutExerciseSearch").value.trim().toLowerCase();
  return availableLibraryExercises().filter(ex=>[ex.name,ex.notes,ex.equipment,ex.movementType,...exercisePrimaryMuscles(ex),...exerciseSecondaryMuscles(ex)].join(" ").toLowerCase().includes(query));
}
function renderAvailableExercisesList(){
  const host=$("availableExercisesList"),filtered=filteredAvailableExercises(),available=availableLibraryExercises();host.innerHTML="";
  for(const category of sections){
    const list=filtered.filter(ex=>ex.category===category);if(!list.length)continue;
    const group=document.createElement("section");group.className="selection-group";group.innerHTML=`<h4>${labels[category]}</h4>`+list.map(ex=>selectionOptionHtml({value:ex.id,name:ex.name,detail:[exercisePrimaryMuscles(ex).slice(0,3).join(", "),ex.equipment].filter(Boolean).join(" · ")||labels[ex.category],checked:addWorkoutExerciseSelection.has(ex.id),kind:"exercise"})).join("");host.appendChild(group);
  }
  if(!filtered.length)host.innerHTML=`<p class="empty-selection muted">${available.length?"No exercises match this search.":"All Library exercises are already added."}</p>`;
  host.querySelectorAll('input[type="checkbox"]').forEach(input=>input.onchange=()=>{if(input.checked)addWorkoutExerciseSelection.add(input.value);else addWorkoutExerciseSelection.delete(input.value);renderAvailableExercisesList();updateAddWorkoutSelectionStatus()});
  const allSelected=filtered.length&&filtered.every(ex=>addWorkoutExerciseSelection.has(ex.id));
  $("selectAllExercisesBtn").textContent=allSelected?"Clear filtered":"Select all";$("selectAllExercisesBtn").disabled=!filtered.length;
  $("exerciseAvailabilityText").textContent=`${available.length} available${filtered.length!==available.length?` · ${filtered.length} shown`:""}`;
}
function updateAddWorkoutSelectionStatus(){
  const mode=document.querySelector('input[name="addMode"]:checked')?.value||"plan",count=mode==="plan"?addWorkoutPlanSelection.size:addWorkoutExerciseSelection.size,button=$("confirmAddWorkoutBtn");
  button.textContent=`Add ${count} Exercise${count===1?"":"s"}`;button.disabled=count===0;
  $("addWorkoutSelectionStatus").textContent=count?`${count} exercise${count===1?"":"s"} selected.`:"Select at least one exercise.";
}
function populateAddWorkout(){
  addWorkoutPlanSelection=new Set();addWorkoutExerciseSelection=new Set();$("addWorkoutExerciseSearch").value="";
  const firstPlan=state.plans.find(plan=>availablePlanItems(plan).length);addWorkoutPlanId=firstPlan?.id||"";
  if(firstPlan)addWorkoutPlanSelection=new Set(availablePlanItems(firstPlan).map(item=>item.id));
  renderAvailablePlans();renderAvailablePlanExercises();renderAvailableExercisesList();updateAddWorkoutSelectionStatus();
}
function updateAddMode(){const mode=document.querySelector('input[name="addMode"]:checked').value;$("addPlanPanel").classList.toggle("hidden",mode!=="plan");$("addExercisePanel").classList.toggle("hidden",mode!=="exercise");updateAddWorkoutSelectionStatus()}
function setAddMode(mode="plan"){
  const input=document.querySelector(`input[name="addMode"][value="${mode}"]`);
  if(input)input.checked=true;
  updateAddMode();
}
function resetAddWorkoutDialog(){
  $("addWorkoutForm").reset();
  $("addWorkoutForm").scrollTop=0;
  addWorkoutPlanId="";addWorkoutPlanSelection=new Set();addWorkoutExerciseSelection=new Set();
  setAddMode("plan");
}
function showDialog(id){
  const dialog=$(id);
  document.body.classList.add("modal-open");
  if(!dialog.open)dialog.showModal();
  const scroller=dialog.querySelector("form,.reference-dialog-content,.confirm-dialog-content");
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
document.querySelectorAll("dialog").forEach(d=>d.addEventListener("close",()=>{if(d.id==="addWorkoutDialog")resetAddWorkoutDialog();if(d.id==="exerciseDialog")clearExercisePhotoObjectUrl();if(d.id==="removeWorkoutItemDialog")pendingWorkoutItemRemoval=null;syncModalLock()}));
$("saveMetricsBtn").onclick=()=>{const weight=Number($("todayWeight").value),bodyFat=Number($("todayBodyFat").value);if(!weight||!bodyFat)return alert("Enter weight and body fat.");state.metrics[todayKey()]={weight,bodyFat};persist()};
$("previousWeekBtn").onclick=()=>{weekOffset--;renderWeek()};$("nextWeekBtn").onclick=()=>{weekOffset++;renderWeek()};$("backThisWeekBtn").onclick=()=>{weekOffset=0;selectedDate=todayKey();renderAll()};
$("openAddWorkoutBtn").onclick=()=>{resetAddWorkoutDialog();populateAddWorkout();setAddMode("plan");showDialog("addWorkoutDialog")};
document.querySelectorAll('input[name="addMode"]').forEach(r=>r.onchange=updateAddMode);
$("addWorkoutExerciseSearch").oninput=renderAvailableExercisesList;
$("selectAllExercisesBtn").onclick=()=>{const filtered=filteredAvailableExercises(),allSelected=filtered.length&&filtered.every(ex=>addWorkoutExerciseSelection.has(ex.id));for(const ex of filtered){if(allSelected)addWorkoutExerciseSelection.delete(ex.id);else addWorkoutExerciseSelection.add(ex.id)}renderAvailableExercisesList();updateAddWorkoutSelectionStatus()};
$("addWorkoutForm").onsubmit=e=>{
  e.preventDefault();const mode=document.querySelector('input[name="addMode"]:checked').value;
  if(mode==="plan"){
    const plan=planById(addWorkoutPlanId);if(!plan||!addWorkoutPlanSelection.size)return;
    if(!addPlanToWorkout(plan,addWorkoutPlanSelection))return alert("The selected exercises are already in the workout.");
  }else{
    if(!addWorkoutExerciseSelection.size)return;
    for(const id of addWorkoutExerciseSelection){const ex=exById(id);if(!ex)continue;const defaults=trackingDefaults(ex),options=ex.category==="cardio"?{intervals:[10,10]}:{sets:defaults.sets,reps:defaults.reps};addActivityToSession(ex,selectedDate,options)}
  }
  closeDialog("addWorkoutDialog");persist();
};
$("addExerciseBtn").onclick=()=>openExercise();
$("exercisePhoto").onchange=e=>{clearExercisePhotoObjectUrl();removeExercisePhotoRequested=false;const file=e.target.files[0];if(file){exercisePhotoObjectUrl=URL.createObjectURL(file);showExercisePhotoPreview(exercisePhotoObjectUrl)}else{const current=exById($("exerciseId").value);showExercisePhotoPreview(current?.photo||"")}};
$("removeExercisePhotoBtn").onclick=()=>{clearExercisePhotoObjectUrl();removeExercisePhotoRequested=true;$("exercisePhoto").value="";showExercisePhotoPreview("")};
$("confirmRemoveWorkoutItemBtn").onclick=()=>{if(!pendingWorkoutItemRemoval)return closeDialog("removeWorkoutItemDialog");const w=workoutFor(pendingWorkoutItemRemoval.date);if(w)w.items=w.items.filter(x=>x.id!==pendingWorkoutItemRemoval.itemId);pendingWorkoutItemRemoval=null;closeDialog("removeWorkoutItemDialog");persist()};
document.addEventListener("click",()=>closeItemMenus());
$("exerciseForm").onsubmit=async e=>{e.preventDefault();const addAfterSave=e.submitter?.value==="save-add",id=$("exerciseId").value,name=$("exerciseName").value.trim();if(!name)return;const exact=state.exercises.some(x=>x.id!==id&&normalizeName(x.name)===normalizeName(name));if(exact)return alert("This exercise already exists.");const similar=similarName(name,id);if(similar&&!confirm(`A similar exercise already exists: ${similar.name}\n\nSave anyway?`))return;const old=id?exById(id):null;let photo=removeExercisePhotoRequested?"":(old?.photo||"");if($("exercisePhoto").files[0])photo=await fileToDataUrl($("exercisePhoto").files[0]);const primaryMuscles=readChoiceValues("exercisePrimaryMuscles","exercisePrimaryCustom"),primaryKeys=new Set(primaryMuscles.map(x=>x.toLowerCase())),secondaryMuscles=readChoiceValues("exerciseSecondaryMuscles","exerciseSecondaryCustom").filter(x=>!primaryKeys.has(x.toLowerCase()));const record={id:id||uid(),name,category:$("exerciseCategory").value,primaryMuscles,secondaryMuscles,equipment:$("exerciseEquipment").value,movementType:$("exerciseMovementType").value,muscle:primaryMuscles.join(", "),photo,link:$("exerciseLink").value.trim(),notes:$("exerciseNotes").value.trim(),archived:false};if(id)state.exercises[state.exercises.findIndex(x=>x.id===id)]=record;else state.exercises.push(record);clearExercisePhotoObjectUrl();closeDialog("exerciseDialog");persist();if(addAfterSave)requestAnimationFrame(()=>openAddTo(exById(record.id)))};
document.querySelectorAll('input[name="addToTarget"]').forEach(input=>input.onchange=updateAddToTarget);
$("addToPlanSelect").onchange=updateAddToStatus;$("addToNewPlanName").oninput=updateAddToStatus;$("addToCardioIntervalBtn").onclick=()=>{addToIntervalDraft.push(addToIntervalDraft.at(-1)||10);renderAddToIntervals()};
$("addToForm").onsubmit=e=>{e.preventDefault();const ex=exById($("addToExerciseId").value),target=selectedAddToTarget();if(!ex)return alert("Exercise not found.");const options=addToFormOptions(ex);if(target==="today"){if(!addActivityToSession(ex,todayKey(),options))return alert("Exercise already added to today’s workout.")}else if(target==="existing-plan"){const plan=planById($("addToPlanSelect").value);if(!plan)return alert("No available plan.");plan.items ||= [];if(plan.items.some(item=>item.exerciseId===ex.id))return alert("Exercise already added to this plan.");plan.items.push(createPlanItem(ex,options))}else{const name=$("addToNewPlanName").value.trim();if(!name)return alert("Enter a plan name.");state.plans.push({id:uid(),name,notes:"",intendedFocus:[],items:[createPlanItem(ex,options)]})}closeDialog("addToDialog");persist()};
$("librarySearch").oninput=renderLibrary;
$("addPlanBtn").onclick=()=>openPlan();$("planCategorySelect").onchange=()=>{populatePlanExerciseOptions();updatePlanFields();intervalDraft=[10,10];renderPlanIntervals()};$("addPlanCardioIntervalBtn").onclick=()=>{intervalDraft.push(intervalDraft.at(-1)||10);renderPlanIntervals()};$("addPlanItemInlineBtn").onclick=addCurrentPlanItem;
$("planForm").onsubmit=e=>{e.preventDefault();planDraft.name=$("planName").value.trim();planDraft.notes=$("planNotes").value.trim();if(!planDraft.name)return;planDraft.id=planDraft.id||uid();const i=state.plans.findIndex(x=>x.id===planDraft.id);if(i>=0)state.plans[i]=structuredClone(planDraft);else state.plans.push(structuredClone(planDraft));closeDialog("planDialog");persist()};
$("openTeacherExportBtn").onclick=openTeacherExport;
$("teacherWeekDate").onchange=updateTeacherExportStatus;
$("teacherExportForm").onsubmit=event=>{
  event.preventDefault();
  const student=$("teacherStudentName").value.trim(),goals=$("teacherGoals").value.trim(),containingDate=$("teacherWeekDate").value;
  const report=buildTeacherSpreadsheetReport({student,goals,containingDate});
  if(!report.dates.length){updateTeacherExportStatus();return}
  state.settings.teacherExport={student,goals};saveState(state);
  try{
    const result=downloadTeacherWorkbook(report);
    $("teacherExportStatus").textContent=`Downloaded ${result.filename}.`;
    setTimeout(()=>closeDialog("teacherExportDialog"),350);
  }catch(error){
    console.error(error);$("teacherExportStatus").textContent="Spreadsheet export failed. Please try again.";
  }
};
$("exportBackupBtn").onclick=()=>downloadBackup(state);$("restoreBackupInput").onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const restored=JSON.parse(await f.text());saveState(restored);state=loadState();renderAll();alert("Backup restored.")}catch{alert("Invalid backup file.")}};$("clearDataBtn").onclick=()=>{if(confirm("Clear all local data?")){state=makeDefaultState();saveState(state);selectedDate=todayKey();weekOffset=0;renderAll()}};
if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"}).then(registration=>registration.update()).catch(()=>{});
renderAll();
