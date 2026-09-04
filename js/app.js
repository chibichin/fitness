import {loadState,saveState,makeDefaultState,downloadBackup,uid} from "./storage.js";
import {downloadTeacherWorkbook} from "./xlsx.js";
import {compressPhotoFile,compressPhotoDataUrl,formatBytes} from "./photo.js";
import {putPhoto,getAllPhotos,deletePhoto,clearPhotos,replaceAllPhotos,photoStorageStats,blobToDataUrl,requestPersistentPhotoStorage} from "./photo-store.js";
import {enableReorder} from "./reorder.js";

let state=loadState();
let selectedDate=todayKey();
let weekOffset=0;
let planDraft=null;
let intervalDraft=[10,10];
let addToIntervalDraft=[10,10];
let pendingWorkoutItemRemoval=null;
let exercisePhotoObjectUrl="";
let removeExercisePhotoRequested=false;
let pendingExercisePhotoBlob=null;
let exercisePhotoCompressionPromise=null;
let exercisePhotoSelectionToken=0;
const exercisePhotoUrls=new Map();
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
function exercisePhotoUrl(ex){return ex?.photoId?exercisePhotoUrls.get(ex.photoId)||"":ex?.photo||""}
function setExercisePhotoUrl(id,blob){
  const previous=exercisePhotoUrls.get(id);
  if(previous)URL.revokeObjectURL(previous);
  if(blob)exercisePhotoUrls.set(id,URL.createObjectURL(blob));
  else exercisePhotoUrls.delete(id);
}
async function refreshExercisePhotoUrls(){
  for(const url of exercisePhotoUrls.values())URL.revokeObjectURL(url);
  exercisePhotoUrls.clear();
  for(const record of await getAllPhotos())if(record?.id&&record.blob)setExercisePhotoUrl(record.id,record.blob);
}
function activeExercises(category){return state.exercises.filter(x=>!x.archived&&(!category||x.category===category))}
function itemCategory(item){return item.category||exById(item.exerciseId)?.category||"strength"}
function isDone(item){return item.type==="cardio"?(item.intervals?.length>0&&item.intervals.every(x=>x.done)):(item.sets?.length>0&&item.sets.every(x=>x.done))}
function storageErrorMessage(error){
  if(error?.name==="StorageFullError")return "App data storage is full. Export a backup before making more changes.";
  if(error?.name==="QuotaExceededError")return "Photo storage is full on this device. Export a full backup before removing photos.";
  return "This change could not be saved. Please export a backup and try again.";
}
function persist(){
  try{saveState(state);renderAll();return true}
  catch(error){console.error(error);alert(storageErrorMessage(error));return false}
}
function workoutFor(key,create=false){if(!state.workouts[key]&&create){state.workouts[key]={date:key,planIds:[],items:[]};saveState(state)}return state.workouts[key]}
function normalizeName(s){return s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g,"")}
function similarName(name,id=""){const n=normalizeName(name);return state.exercises.find(x=>x.id!==id&&(normalizeName(x.name)===n||normalizeName(x.name).includes(n)||n.includes(normalizeName(x.name))))}
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
    const lastSet=[...(item.sets||[])].reverse().find(set=>Number(set?.weight)>0&&Number(set?.reps)>0);
    if(!lastSet)continue;
    return {date,lastSet:{weight:Number(lastSet.weight),reps:Number(lastSet.reps)}};
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
  const defaults=trackingDefaults(ex),count=Math.max(1,Number(options.sets)||defaults.sets),planReps=Number(options.reps)||defaults.reps;
  const previous=ex.category==="strength"?previousTrackingValues(ex.id,date):null;
  const startingSet=previous?.lastSet;
  const sets=Array.from({length:count},()=>({weight:startingSet?.weight??0,reps:startingSet?.reps??planReps,done:false}));
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
  return previous?`Last set: ${previous.lastSet.reps} reps · ${previous.lastSet.weight} lb on ${previous.date}. This will prefill all sets.`:"";
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
      const group={key,title:isPlanItem?(plan?.name||item.sourcePlanName||"Plan"):labels[category],items:[],isPlan:isPlanItem,sourcePlanId:isPlanItem?item.sourcePlanId:""};
      lookup.set(key,group);groups.push(group);
    }
    lookup.get(key).items.push(item);
  }
  return groups;
}
function reorderWorkoutGroups(groupKeys){
  const workout=workoutFor(selectedDate),groups=workoutGroups(workout),byKey=new Map(groups.map(group=>[group.key,group]));
  const ordered=groupKeys.map(key=>byKey.get(key)).filter(Boolean);
  groups.filter(group=>!groupKeys.includes(group.key)).forEach(group=>ordered.push(group));
  workout.items=ordered.flatMap(group=>group.items);
  try{saveState(state)}catch(error){console.error(error);alert(storageErrorMessage(error))}
}
function reorderWorkoutGroupItems(groupKey,itemIds){
  const workout=workoutFor(selectedDate),groups=workoutGroups(workout),group=groups.find(entry=>entry.key===groupKey);
  if(!group)return;
  const byId=new Map(group.items.map(item=>[item.id,item]));
  group.items=itemIds.map(id=>byId.get(id)).filter(Boolean);
  workout.items=groups.flatMap(entry=>entry.key===groupKey?group.items:entry.items);
  try{saveState(state)}catch(error){console.error(error);alert(storageErrorMessage(error))}
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
    const section=document.createElement("section");section.className="workout-section";section.dataset.groupKey=group.key;
    const header=document.createElement("button");header.className="workout-section-header";
    header.innerHTML=`<span><b>${escapeHtml(group.title)}</b><small>${doneCount}/${entries.length} complete</small></span><b>⌄</b>`;
    const top=document.createElement("div");top.className="workout-section-top";
    const panelHandle=document.createElement("button");panelHandle.type="button";panelHandle.className="secondary drag-handle panel-drag-handle";panelHandle.textContent="⠿";panelHandle.setAttribute("aria-label",`Reorder ${group.title} panel`);panelHandle.title="Hold and drag to reorder; arrow keys also work";top.appendChild(panelHandle);
    top.appendChild(header);
    const remove=document.createElement("button");remove.type="button";remove.className="secondary remove-panel-from-workout";remove.textContent="Remove";remove.setAttribute("aria-label",`Remove ${group.title} panel from workout`);remove.onclick=()=>openRemoveWorkoutGroup(group);top.appendChild(remove);
    const body=document.createElement("div");body.className="workout-section-body";
    const storageKey=`section-open-${selectedDate}-${group.key}`;
    let open=localStorage.getItem(storageKey)!=="false";
    if(doneCount===entries.length)open=false;
    body.classList.toggle("hidden",!open);
    header.onclick=()=>{
      const nextOpen=body.classList.contains("hidden");
      body.classList.toggle("hidden",!nextOpen);
      localStorage.setItem(storageKey,String(nextOpen));
    };
    let divider=false;
    for(const item of entries){
      if(isDone(item)&&!divider){const d=document.createElement("div");d.className="completed-label";d.textContent="Completed";body.appendChild(d);divider=true}
      const card=renderWorkoutItem(item);card.dataset.itemId=item.id;body.appendChild(card);
    }
    section.append(top,body);host.appendChild(section);
    enableReorder({container:body,itemSelector:".workout-item",handleSelector:".exercise-drag-handle",idAttribute:"itemId",onCommit:ids=>reorderWorkoutGroupItems(group.key,ids)});
  }
  enableReorder({container:host,itemSelector:".workout-section",handleSelector:".panel-drag-handle",idAttribute:"groupKey",onCommit:reorderWorkoutGroups});
}
function closeItemMenus(except=null){document.querySelectorAll(".item-menu").forEach(menu=>{if(menu!==except){menu.classList.add("hidden");menu.closest(".workout-item")?.querySelector(".more")?.setAttribute("aria-expanded","false")}})}
function openRemoveWorkoutItem(item){
  pendingWorkoutItemRemoval={type:"item",date:selectedDate,itemId:item.id};
  const ex=exById(item.exerciseId),name=ex?.name||item.exerciseName||"this exercise",plan=item.sourcePlanId?(planById(item.sourcePlanId)?.name||item.sourcePlanName):"";
  $("removeWorkoutDialogTitle").textContent="Remove exercise?";
  $("removeWorkoutItemMessage").textContent=plan?`Remove ${name} from “${plan}”?`:`Remove ${name} from this workout?`;
  $("removeWorkoutItemNote").textContent="This only removes it from this date. Your Library and saved plan will not change.";
  showDialog("removeWorkoutItemDialog");
  requestAnimationFrame(()=>$("cancelRemoveWorkoutItemBtn").focus());
}
function openRemoveWorkoutGroup(group){
  pendingWorkoutItemRemoval={type:"group",date:selectedDate,itemIds:group.items.map(item=>item.id),sourcePlanId:group.sourcePlanId};
  $("removeWorkoutDialogTitle").textContent="Remove panel?";$("removeWorkoutItemMessage").textContent=`Remove the “${group.title}” panel and all ${group.items.length} exercise${group.items.length===1?"":"s"} from this workout?`;
  $("removeWorkoutItemNote").textContent="This only removes this panel from this date. Your Library and saved Plans will not change.";showDialog("removeWorkoutItemDialog");requestAnimationFrame(()=>$("cancelRemoveWorkoutItemBtn").focus());
}
function applyWorkoutRemoval(pending){
  const w=workoutFor(pending.date);if(!w)return;
  if(pending.type==="group"){const ids=new Set(pending.itemIds||[]);w.items=w.items.filter(item=>!ids.has(item.id));if(pending.sourcePlanId)w.planIds=(w.planIds||[]).filter(id=>id!==pending.sourcePlanId)}
  else w.items=w.items.filter(item=>item.id!==pending.itemId);
}
function renderWorkoutItem(item){
  const ex=exById(item.exerciseId),displayName=ex?.name||item.exerciseName||"Exercise",card=document.createElement("div");card.className="workout-item"+(isDone(item)?" completed":"");
  const setActions=item.type==="cardio"?"":'<button class="secondary add-set-action" type="button">Add set</button><button class="secondary remove-set-action" type="button">Remove last set</button>';
  card.innerHTML=`<div class="item-head"><div class="item-title-with-drag"><button type="button" class="secondary drag-handle exercise-drag-handle" aria-label="Reorder ${escapeHtml(displayName)}" title="Hold and drag to reorder; arrow keys also work">⠿</button><div><strong>${escapeHtml(displayName)}</strong><div class="muted">${labels[itemCategory(item)]}</div></div></div><div class="item-actions"><button class="secondary reference" type="button">Ref</button><button class="secondary more" type="button" aria-label="Exercise actions" aria-expanded="false">⋯</button></div></div><div class="item-menu hidden">${setActions}<button class="danger remove-exercise-action" type="button">Remove exercise</button></div><div class="item-body"></div>`;
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
  const photoUrl=exercisePhotoUrl(ex);
  $("referenceImage").src=photoUrl;
  $("referenceImageViewport").classList.remove("zoomed");
  $("referenceImageViewport").classList.toggle("hidden",!photoUrl);
  $("referenceZoomBtn").classList.toggle("hidden",!photoUrl);
  $("referenceZoomBtn").textContent="View full-size photo";
  const meta=exerciseMetaHtml(ex);$("referenceMuscleMeta").innerHTML=meta;$("referenceMuscleMeta").classList.toggle("hidden",!meta);
  $("referenceNotes").classList.toggle("hidden",!ex?.notes);$("referenceNotes").textContent=ex?.notes||"";
  $("referenceLink").classList.toggle("hidden",!ex?.link);$("referenceLink").href=ex?.link||"#";
  $("referenceEmpty").classList.toggle("hidden",Boolean(photoUrl||meta||ex?.notes||ex?.link));
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
  const host=$("planItemsList");
  host.innerHTML=(planDraft.items||[]).map(x=>{
    const ex=exById(x.exerciseId),summary=x.type==="cardio"?`${(x.intervals||[]).join(" / ")} min`:`${x.sets} × ${x.reps}`;
    return `<div class="plan-item" data-item-id="${escapeHtml(x.id)}"><div class="plan-item-row"><button type="button" class="secondary drag-handle plan-item-drag-handle" aria-label="Reorder ${escapeHtml(ex?.name||x.exerciseName||"Exercise")}" title="Hold and drag to reorder; arrow keys also work">⠿</button><div class="plan-item-copy"><strong>${escapeHtml(ex?.name||x.exerciseName||"Exercise")}</strong><div class="muted">${labels[x.category||ex?.category||"strength"]} · ${escapeHtml(summary)}</div></div><button type="button" class="secondary remove-plan-item" data-id="${escapeHtml(x.id)}">Remove</button></div></div>`;
  }).join("")||'<p class="muted">No items.</p>';
  host.querySelectorAll(".remove-plan-item").forEach(b=>b.onclick=()=>{planDraft.items=planDraft.items.filter(x=>x.id!==b.dataset.id);renderPlanDraft();populatePlanExerciseOptions()});
  enableReorder({container:host,itemSelector:".plan-item",handleSelector:".plan-item-drag-handle",idAttribute:"itemId",onCommit:ids=>{const byId=new Map(planDraft.items.map(item=>[item.id,item]));planDraft.items=ids.map(id=>byId.get(id)).filter(Boolean)}});
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
    for(const ex of list){const card=document.createElement("article");card.className="list-card";const meta=exerciseMetaHtml(ex),photoUrl=exercisePhotoUrl(ex);
      card.innerHTML=`<strong>${escapeHtml(ex.name)}</strong>${meta?`<div class="exercise-meta">${meta}</div>`:'<p class="muted">No muscle details</p>'}${photoUrl?`<img src="${photoUrl}" class="reference-photo" alt="">`:""}${ex.notes?`<p>${escapeHtml(ex.notes)}</p>`:""}${ex.link?`<a href="${escapeHtml(ex.link)}" target="_blank" rel="noopener">Open reference</a>`:""}<div class="actions library-actions"><button class="add-to-exercise">Add to…</button><button class="secondary edit-exercise">Edit</button><button class="danger delete-exercise">Delete</button></div>`;
      card.querySelector(".add-to-exercise").onclick=()=>openAddTo(ex);
      card.querySelector(".edit-exercise").onclick=()=>openExercise(ex);
      card.querySelector(".delete-exercise").onclick=()=>deleteExercise(ex);
      sec.appendChild(card);
    }
    host.appendChild(sec);
  }
  if(!host.children.length)host.innerHTML='<article class="card"><p class="muted">No matching exercises.</p></article>';
}
async function deleteExercise(ex){
  const planCount=state.plans.filter(p=>(p.items||[]).some(i=>i.exerciseId===ex.id)).length;
  const workoutCount=Object.values(state.workouts).filter(w=>(w.items||[]).some(i=>i.exerciseId===ex.id)).length;
  const detail=(planCount||workoutCount)?`\n\nUsed in ${planCount} plan(s) and ${workoutCount} workout date(s). Workout history will keep the exercise name.`:"";
  if(!confirm(`Delete "${ex.name}"?${detail}`))return;
  if(ex.photoId){
    try{await deletePhoto(ex.photoId);setExercisePhotoUrl(ex.photoId,null)}
    catch(error){console.error(error);return alert("The exercise was not deleted because its saved photo could not be removed.")}
  }
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


// Teacher date-range spreadsheet export. Every record-bearing date becomes one
// continuous worksheet column so the complete range prints on one Letter page.
function dateFromKey(key){return new Date(`${key}T12:00:00`)}
function teacherDateRangeKeys(beginDate,endDate){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(beginDate||""))||!/^\d{4}-\d{2}-\d{2}$/.test(String(endDate||""))||beginDate>endDate)return [];
  const cursor=dateFromKey(beginDate),end=dateFromKey(endDate),keys=[];
  while(cursor<=end){keys.push(keyFromDate(cursor));cursor.setDate(cursor.getDate()+1)}
  return keys;
}
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
function teacherStrengthValue(item){
  const sets=(item?.sets||[]).filter(set=>Number(set.reps)>0||Number(set.weight)>0||set.done);
  if(!sets.length)return "";
  const values=sets.map(set=>({reps:Number(set.reps)||0,weight:Number(set.weight)||0}));
  const same=values.every(value=>value.reps===values[0].reps&&value.weight===values[0].weight);
  if(same){
    const {reps,weight}=values[0];
    if(weight>0&&reps>0)return `${values.length}×${reps} @ ${weight} lb`;
    if(reps>0)return `${values.length}×${reps} reps`;
    return `${values.length} sets`;
  }
  const hasWeight=values.some(value=>value.weight>0);
  if(!hasWeight)return `${values.map(value=>value.reps||"–").join(" / ")} reps`;
  return values.map(value=>`${value.reps||"–"}×${value.weight||"–"}`).join(" / ");
}
function teacherStrengthSetCount(item){
  const count=(item?.sets||[]).filter(set=>Number(set.reps)>0||Number(set.weight)>0||set.done).length;
  return count?`${count} set${count===1?"":"s"}`:"";
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
function teacherStrengthReportRow(row,dates){
  return {name:row.name,detail:teacherStrengthSetCount(row.latest),values:dates.map(date=>teacherStrengthValue(row.byDate[date]))};
}
function buildTeacherSpreadsheetReport({student,goals,beginDate,endDate}){
  const dates=teacherDateRangeKeys(beginDate,endDate).filter(key=>(state.workouts[key]?.items||[]).length);
  if(!dates.length)return {beginDate,endDate,dates:[],pages:[]};
  const warm=teacherRows(dates,"warmup"),strength=teacherRows(dates,"strength"),flexibility=teacherRows(dates,"flexibility"),cardioByDate=dates.map(teacherCardioForDate);
  const page={
    dates:dates.map(key=>({key,label:teacherDateLabel(key)})),
    warmup:warm.map(row=>teacherReportRow(row,dates,teacherCompletedMark)),
    strength:strength.map(row=>teacherStrengthReportRow(row,dates)),
    cardio:{names:cardioByDate.map(item=>item.name),heartRates:cardioByDate.map(item=>item.heartRate),minutes:cardioByDate.map(item=>item.minutes)},
    flexibility:flexibility.map(row=>teacherReportRow(row,dates,teacherCompletedMark))
  };
  return {student,goals,beginDate,endDate,dateRangeLabel:`${teacherDateLabel(beginDate)} - ${teacherDateLabel(endDate)}`,dates,page,pages:[page]};
}
function updateTeacherExportStatus(){
  const beginDate=$("teacherBeginDate").value,endDate=$("teacherEndDate").value,status=$("teacherExportStatus");
  if(!beginDate||!endDate){status.textContent="Select beginning and ending dates.";return}
  if(beginDate>endDate){status.textContent="Beginning date must be on or before ending date.";return}
  const dates=teacherDateRangeKeys(beginDate,endDate).filter(key=>(state.workouts[key]?.items||[]).length);
  status.textContent=dates.length?`${dates.length} workout date${dates.length===1?"":"s"} will be placed in continuous columns on one worksheet.`:"No workout records in this date range.";
}
function openTeacherExport(){
  const saved=state.settings.teacherExport||{},base=dateFromKey(selectedDate),monthStart=new Date(base.getFullYear(),base.getMonth(),1,12),monthEnd=new Date(base.getFullYear(),base.getMonth()+1,0,12);
  $("teacherStudentName").value=saved.student||"";$("teacherGoals").value=saved.goals||"";$("teacherBeginDate").value=keyFromDate(monthStart);$("teacherEndDate").value=keyFromDate(monthEnd);
  updateTeacherExportStatus();showDialog("teacherExportDialog");
}

async function renderStorageUsage(){
  const host=$("storageUsage");if(!host)return;
  const json=JSON.stringify(state),appBytes=new Blob([json]).size;
  try{
    const photos=await photoStorageStats();
    host.textContent=`App data: approximately ${formatBytes(appBytes)} · ${photos.count} saved photo${photos.count===1?"":"s"}: ${formatBytes(photos.bytes)}. Photos are stored separately from app data.`;
  }catch{
    host.textContent=`App data: approximately ${formatBytes(appBytes)}. Photo storage is temporarily unavailable.`;
  }
}

function downloadJsonFile(value,filename){
  const link=document.createElement("a");
  link.href=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));
  link.download=filename;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}

async function downloadFullBackup(){
  const button=$("exportFullBackupBtn");
  button.disabled=true;button.textContent="Preparing photos…";
  try{
    const backup=structuredClone(state),photos=new Map((await getAllPhotos()).map(record=>[record.id,record]));
    backup.version="1.4.11";
    backup.backupType="full";
    for(const exercise of backup.exercises||[]){
      const record=exercise.photoId?photos.get(exercise.photoId):null;
      exercise.photo=record?.blob?await blobToDataUrl(record.blob):String(exercise.photo||"");
    }
    downloadJsonFile(backup,`fitness-full-backup-${new Date().toISOString().slice(0,10)}.json`);
  }catch(error){
    console.error(error);
    alert("The full backup could not be prepared. Please try again.");
  }finally{
    button.disabled=false;button.textContent="Export full backup (with photos)";
  }
}

async function prepareRestoredBackup(restored){
  const prepared=structuredClone(restored),photoEntries=[];
  let originalBytes=0,storedBytes=0;
  prepared.version="1.4.11";
  delete prepared.backupType;
  for(const exercise of prepared.exercises||[]){
    const legacyPhoto=String(exercise.photo||"");
    exercise.photo="";
    exercise.photoId="";
    if(!legacyPhoto.startsWith("data:image/"))continue;
    const result=await compressPhotoDataUrl(legacyPhoto);
    photoEntries.push({id:exercise.id,blob:result.blob});
    exercise.photoId=exercise.id;
    originalBytes+=result.originalBytes;
    storedBytes+=result.compressedBytes;
  }
  await replaceAllPhotos(photoEntries);
  saveState(prepared);
  state=loadState();
  await refreshExercisePhotoUrls();
  return {count:photoEntries.length,originalBytes,storedBytes};
}

async function migrateLegacyPhotos(){
  let migrated=0,originalBytes=0,storedBytes=0;
  for(const exercise of state.exercises||[]){
    const legacyPhoto=String(exercise.photo||"");
    if(!legacyPhoto.startsWith("data:image/"))continue;
    const result=await compressPhotoDataUrl(legacyPhoto);
    await putPhoto(exercise.id,result.blob);
    exercise.photoId=exercise.id;
    exercise.photo="";
    saveState(state);
    migrated++;
    originalBytes+=result.originalBytes;
    storedBytes+=result.compressedBytes;
  }
  return {migrated,originalBytes,storedBytes};
}

function renderAll(){renderHeader();renderWeek();renderWorkout();renderPlans();renderLibrary();renderProgress();renderStorageUsage()}

function clearExercisePhotoObjectUrl(){if(exercisePhotoObjectUrl){URL.revokeObjectURL(exercisePhotoObjectUrl);exercisePhotoObjectUrl=""}}
function showExercisePhotoPreview(src=""){$("exercisePhotoPreview").src=src;$("exercisePhotoPreviewWrap").classList.toggle("hidden",!src)}
function setExercisePhotoStatus(message="Photos are optimized for readable text and stored separately from app data.",kind=""){
  const status=$("exercisePhotoStatus");status.textContent=message;status.classList.toggle("working",kind==="working");status.classList.toggle("error",kind==="error");
}
function openExercise(ex=null){
  clearExercisePhotoObjectUrl();removeExercisePhotoRequested=false;pendingExercisePhotoBlob=null;exercisePhotoCompressionPromise=null;exercisePhotoSelectionToken++;
  $("exerciseDialogTitle").textContent=ex?"Edit exercise":"Add exercise";$("exerciseId").value=ex?.id||"";$("exerciseName").value=ex?.name||"";$("exerciseCategory").value=ex?.category||"strength";
  setChoiceValues("exercisePrimaryMuscles","exercisePrimaryCustom",exercisePrimaryMuscles(ex));setChoiceValues("exerciseSecondaryMuscles","exerciseSecondaryCustom",exerciseSecondaryMuscles(ex));
  $("exerciseEquipment").value=ex?.equipment||"";$("exerciseMovementType").value=ex?.movementType||"";$("exerciseLink").value=ex?.link||"";$("exerciseNotes").value=ex?.notes||"";$("exercisePhoto").value="";showExercisePhotoPreview(exercisePhotoUrl(ex));setExercisePhotoStatus();showDialog("exerciseDialog");
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
$("referenceZoomBtn").onclick=()=>{
  const viewport=$("referenceImageViewport"),zoomed=viewport.classList.toggle("zoomed");
  $("referenceZoomBtn").textContent=zoomed?"Fit photo to screen":"View full-size photo";
  if(!zoomed){viewport.scrollTop=0;viewport.scrollLeft=0}
};
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeDialog(b.dataset.close));
document.querySelectorAll("dialog").forEach(d=>d.addEventListener("close",()=>{
  if(d.id==="addWorkoutDialog")resetAddWorkoutDialog();
  if(d.id==="exerciseDialog"){exercisePhotoSelectionToken++;exercisePhotoCompressionPromise=null;pendingExercisePhotoBlob=null;clearExercisePhotoObjectUrl()}
  if(d.id==="removeWorkoutItemDialog")pendingWorkoutItemRemoval=null;
  syncModalLock();
}));
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
$("exercisePhoto").onchange=e=>{
  clearExercisePhotoObjectUrl();removeExercisePhotoRequested=false;pendingExercisePhotoBlob=null;
  const file=e.target.files[0],current=exById($("exerciseId").value),token=++exercisePhotoSelectionToken;
  if(!file){exercisePhotoCompressionPromise=null;showExercisePhotoPreview(exercisePhotoUrl(current));setExercisePhotoStatus();return}
  exercisePhotoObjectUrl=URL.createObjectURL(file);showExercisePhotoPreview(exercisePhotoObjectUrl);setExercisePhotoStatus("Preparing and optimizing photo…","working");
  exercisePhotoCompressionPromise=(async()=>{
    try{
      const result=await compressPhotoFile(file);
      if(token!==exercisePhotoSelectionToken)return false;
      pendingExercisePhotoBlob=result.blob;clearExercisePhotoObjectUrl();exercisePhotoObjectUrl=URL.createObjectURL(result.blob);showExercisePhotoPreview(exercisePhotoObjectUrl);
      const details=result.changed?`${formatBytes(result.originalBytes)} → ${formatBytes(result.compressedBytes)}`:formatBytes(result.compressedBytes);
      setExercisePhotoStatus(`Photo ready (${details}, ${result.width} × ${result.height}). Text-quality detail is preserved.`);
      return true;
    }catch(error){
      if(token!==exercisePhotoSelectionToken)return false;
      console.error(error);pendingExercisePhotoBlob=null;clearExercisePhotoObjectUrl();$("exercisePhoto").value="";showExercisePhotoPreview(exercisePhotoUrl(current));
      setExercisePhotoStatus(error.message||"The photo could not be prepared.","error");
      return false;
    }
  })();
};
$("removeExercisePhotoBtn").onclick=()=>{
  exercisePhotoSelectionToken++;exercisePhotoCompressionPromise=null;pendingExercisePhotoBlob=null;clearExercisePhotoObjectUrl();removeExercisePhotoRequested=true;$("exercisePhoto").value="";showExercisePhotoPreview("");setExercisePhotoStatus("Photo will be removed when you save.");
};
$("confirmRemoveWorkoutItemBtn").onclick=()=>{
  if(!pendingWorkoutItemRemoval)return closeDialog("removeWorkoutItemDialog");const pending=pendingWorkoutItemRemoval;applyWorkoutRemoval(pending);
  pendingWorkoutItemRemoval=null;closeDialog("removeWorkoutItemDialog");persist();
};
document.addEventListener("click",()=>closeItemMenus());
$("exerciseForm").onsubmit=async e=>{
  e.preventDefault();
  const addAfterSave=e.submitter?.value==="save-add",id=$("exerciseId").value,name=$("exerciseName").value.trim();
  if(!name)return;
  const exact=state.exercises.some(x=>x.id!==id&&normalizeName(x.name)===normalizeName(name));
  if(exact)return alert("This exercise already exists.");
  const similar=similarName(name,id);
  if(similar&&!confirm(`A similar exercise already exists: ${similar.name}\n\nSave anyway?`))return;
  if(exercisePhotoCompressionPromise){
    setExercisePhotoStatus("Finishing photo preparation…","working");
    const ready=await exercisePhotoCompressionPromise;
    if(!ready)return;
  }
  const old=id?exById(id):null;
  const recordId=id||uid();
  let photoId=old?.photoId||"";
  try{
    if(removeExercisePhotoRequested){
      if(photoId)await deletePhoto(photoId);
      if(photoId)setExercisePhotoUrl(photoId,null);
      photoId="";
    }else if(pendingExercisePhotoBlob){
      await putPhoto(recordId,pendingExercisePhotoBlob);
      setExercisePhotoUrl(recordId,pendingExercisePhotoBlob);
      photoId=recordId;
    }
  }catch(error){
    console.error(error);
    setExercisePhotoStatus(storageErrorMessage(error),"error");
    return;
  }
  const legacyPhoto=!photoId&&!removeExercisePhotoRequested&&!pendingExercisePhotoBlob?String(old?.photo||""):"";
  const primaryMuscles=readChoiceValues("exercisePrimaryMuscles","exercisePrimaryCustom"),primaryKeys=new Set(primaryMuscles.map(x=>x.toLowerCase())),secondaryMuscles=readChoiceValues("exerciseSecondaryMuscles","exerciseSecondaryCustom").filter(x=>!primaryKeys.has(x.toLowerCase()));
  const record={id:recordId,name,category:$("exerciseCategory").value,primaryMuscles,secondaryMuscles,equipment:$("exerciseEquipment").value,movementType:$("exerciseMovementType").value,muscle:primaryMuscles.join(", "),photo:legacyPhoto,photoId,link:$("exerciseLink").value.trim(),notes:$("exerciseNotes").value.trim(),archived:false};
  const index=id?state.exercises.findIndex(x=>x.id===id):-1;
  if(index>=0)state.exercises[index]=record;else state.exercises.push(record);
  if(!persist()){
    if(index>=0)state.exercises[index]=old;else state.exercises.pop();
    setExercisePhotoStatus("The exercise could not be saved because browser storage is full.","error");
    return;
  }
  clearExercisePhotoObjectUrl();closeDialog("exerciseDialog");
  if(addAfterSave)requestAnimationFrame(()=>openAddTo(exById(record.id)));
};
document.querySelectorAll('input[name="addToTarget"]').forEach(input=>input.onchange=updateAddToTarget);
$("addToPlanSelect").onchange=updateAddToStatus;$("addToNewPlanName").oninput=updateAddToStatus;$("addToCardioIntervalBtn").onclick=()=>{addToIntervalDraft.push(addToIntervalDraft.at(-1)||10);renderAddToIntervals()};
$("addToForm").onsubmit=e=>{e.preventDefault();const ex=exById($("addToExerciseId").value),target=selectedAddToTarget();if(!ex)return alert("Exercise not found.");const options=addToFormOptions(ex);if(target==="today"){if(!addActivityToSession(ex,todayKey(),options))return alert("Exercise already added to today’s workout.")}else if(target==="existing-plan"){const plan=planById($("addToPlanSelect").value);if(!plan)return alert("No available plan.");plan.items ||= [];if(plan.items.some(item=>item.exerciseId===ex.id))return alert("Exercise already added to this plan.");plan.items.push(createPlanItem(ex,options))}else{const name=$("addToNewPlanName").value.trim();if(!name)return alert("Enter a plan name.");state.plans.push({id:uid(),name,notes:"",intendedFocus:[],items:[createPlanItem(ex,options)]})}closeDialog("addToDialog");persist()};
$("librarySearch").oninput=renderLibrary;
$("addPlanBtn").onclick=()=>openPlan();$("planCategorySelect").onchange=()=>{populatePlanExerciseOptions();updatePlanFields();intervalDraft=[10,10];renderPlanIntervals()};$("addPlanCardioIntervalBtn").onclick=()=>{intervalDraft.push(intervalDraft.at(-1)||10);renderPlanIntervals()};$("addPlanItemInlineBtn").onclick=addCurrentPlanItem;
$("planForm").onsubmit=e=>{e.preventDefault();planDraft.name=$("planName").value.trim();planDraft.notes=$("planNotes").value.trim();if(!planDraft.name)return;planDraft.id=planDraft.id||uid();const i=state.plans.findIndex(x=>x.id===planDraft.id);if(i>=0)state.plans[i]=structuredClone(planDraft);else state.plans.push(structuredClone(planDraft));closeDialog("planDialog");persist()};
$("openTeacherExportBtn").onclick=openTeacherExport;
$("teacherBeginDate").onchange=updateTeacherExportStatus;
$("teacherEndDate").onchange=updateTeacherExportStatus;
$("teacherExportForm").onsubmit=event=>{
  event.preventDefault();
  const student=$("teacherStudentName").value.trim(),goals=$("teacherGoals").value.trim(),beginDate=$("teacherBeginDate").value,endDate=$("teacherEndDate").value;
  if(!beginDate||!endDate||beginDate>endDate){updateTeacherExportStatus();return}
  const report=buildTeacherSpreadsheetReport({student,goals,beginDate,endDate});
  if(!report.pages.length){updateTeacherExportStatus();return}
  state.settings.teacherExport={student,goals};saveState(state);
  try{
    const result=downloadTeacherWorkbook(report);
    $("teacherExportStatus").textContent=`Downloaded ${result.filename}.`;
    setTimeout(()=>closeDialog("teacherExportDialog"),350);
  }catch(error){
    console.error(error);$("teacherExportStatus").textContent="Spreadsheet export failed. Please try again.";
  }
};
$("exportFullBackupBtn").onclick=downloadFullBackup;
$("exportDataBackupBtn").onclick=()=>downloadBackup(state);
$("restoreBackupInput").onchange=async e=>{
  const input=e.target,f=input.files[0];if(!f)return;
  let restored;
  try{
    restored=JSON.parse(await f.text());
    if(!restored||typeof restored!=="object"||!Array.isArray(restored.exercises))throw new Error("Invalid structure");
  }catch{
    input.value="";alert("Invalid backup file. The JSON file could not be read.");return;
  }
  try{
    const result=await prepareRestoredBackup(restored);
    renderAll();input.value="";
    const note=result.count?` ${result.count} photo${result.count===1?" was":"s were"} restored to separate photo storage (${formatBytes(result.storedBytes)}).`:" This backup did not contain photos.";
    alert(`Backup restored.${note}`);
  }catch(error){
    console.error(error);input.value="";
    alert(error?.name==="StorageFullError"||error?.name==="QuotaExceededError"?storageErrorMessage(error):(error?.message||"A photo in this backup could not be prepared."));
  }
};
$("clearDataBtn").onclick=async()=>{
  if(!confirm("Clear all local data and saved photos from this device?"))return;
  try{
    await clearPhotos();
    for(const url of exercisePhotoUrls.values())URL.revokeObjectURL(url);
    exercisePhotoUrls.clear();
    state=makeDefaultState();saveState(state);selectedDate=todayKey();weekOffset=0;renderAll();
  }catch(error){
    console.error(error);alert("Local data could not be cleared. Please try again.");
  }
};
if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"}).then(registration=>registration.update()).catch(()=>{});
async function initializeApp(){
  try{
    requestPersistentPhotoStorage();
    const result=await migrateLegacyPhotos();
    await refreshExercisePhotoUrls();
    if(result.migrated){
      const saved=Math.max(0,result.originalBytes-result.storedBytes);
      setTimeout(()=>alert(`${result.migrated} existing photo${result.migrated===1?" was":"s were"} moved to separate photo storage. App data was reduced by approximately ${formatBytes(result.originalBytes)}${saved?` and the photos were compressed by ${formatBytes(saved)}`:""}.`),0);
    }
  }catch(error){
    console.error(error);
    setTimeout(()=>alert(error?.message||"Existing photos could not be moved to separate storage. They remain in the current app data."),0);
  }
  renderAll();
}
initializeApp();
