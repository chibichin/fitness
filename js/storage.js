export const KEY="fitness-record-v1";

export function makeDefaultState(){
  const exercises=[
    {id:crypto.randomUUID(),name:"Knee Hug",category:"warmup",muscle:"Legs",photo:"",link:"",notes:"",archived:false},
    {id:crypto.randomUUID(),name:"Hip Circle",category:"warmup",muscle:"Hips",photo:"",link:"",notes:"",archived:false},
    {id:crypto.randomUUID(),name:"Squat",category:"strength",muscle:"Legs",photo:"",link:"",notes:"",archived:false},
    {id:crypto.randomUUID(),name:"Bench Press",category:"strength",muscle:"Chest",photo:"",link:"",notes:"",archived:false},
    {id:crypto.randomUUID(),name:"Bike",category:"cardio",muscle:"",photo:"",link:"",notes:"",archived:false},
    {id:crypto.randomUUID(),name:"Hamstring Stretch",category:"flexibility",muscle:"Legs",photo:"",link:"",notes:"",archived:false}
  ];
  return {version:"1.1",exercises,plans:[],workouts:{},metrics:{},settings:{}};
}

export function normalizeState(s){
  if(!s||typeof s!=="object")return makeDefaultState();
  s.version="1.1";s.exercises||=[];s.plans||=[];s.workouts||={};s.metrics||={};s.settings||={};
  s.exercises.forEach(x=>{x.archived??=false;x.photo||="";x.link||="";x.notes||="";x.muscle||="";x.category||="strength"});
  s.plans=s.plans.map(p=>({
    ...p,
    id:p.id||crypto.randomUUID(),
    name:p.name||"Plan",
    notes:p.notes||"",
    items:[...(p.warmupAdditions||[]),...(p.items||[])].map(i=>({
      ...i,
      id:i.id||crypto.randomUUID(),
      exerciseName:i.exerciseName||s.exercises.find(e=>e.id===i.exerciseId)?.name||"Exercise",
      intervals:i.type==="cardio"?(i.intervals||[10]).map(x=>Number(typeof x==="object"?x.minutes:x)||1):i.intervals
    }))
  }));
  const plansById=new Map(s.plans.map(p=>[p.id,p]));
  Object.values(s.workouts).forEach(w=>{
    w.planIds||=[];w.items||=[];
    w.items.forEach(i=>{
      i.id||=crypto.randomUUID();
      i.exerciseName||=s.exercises.find(e=>e.id===i.exerciseId)?.name||"Exercise";
      i.category||=s.exercises.find(e=>e.id===i.exerciseId)?.category||"strength";
      if(i.type==="cardio"){
        i.intervals=(i.intervals||[{minutes:10,done:false}]).map(interval=>{
          const normalized=typeof interval==="number"?{minutes:interval,done:false}:interval;
          return {minutes:Number(normalized.minutes)||1,targetHr:normalized.targetHr??i.targetHr??"",done:Boolean(normalized.done)};
        });
      }else{
        i.type="exercise";
        i.sets=(i.sets||[{weight:0,reps:1,done:false}]).map(set=>({weight:Number(set.weight)||0,reps:Number(set.reps)||0,done:Boolean(set.done)}));
      }
      if(i.sourcePlanId){i.sourcePlanName||=plansById.get(i.sourcePlanId)?.name||"Plan"}
    });
    // v1.0 only stored workout.planIds. Infer plan ownership once for matching items.
    for(const planId of w.planIds){
      const plan=plansById.get(planId);if(!plan)continue;
      for(const planItem of plan.items||[]){
        if(w.items.some(item=>item.sourcePlanId===plan.id&&item.sourcePlanItemId===planItem.id))continue;
        const match=w.items.find(item=>!item.sourcePlanId&&item.exerciseId===planItem.exerciseId);
        if(match){match.sourcePlanId=plan.id;match.sourcePlanName=plan.name;match.sourcePlanItemId=planItem.id}
      }
    }
  });
  return s;
}

export function loadState(){
  try{return normalizeState(JSON.parse(localStorage.getItem(KEY)))}catch{return makeDefaultState()}
}
export function saveState(s){localStorage.setItem(KEY,JSON.stringify(s))}
export function downloadBackup(s){
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([JSON.stringify(s,null,2)],{type:"application/json"}));
  a.download=`fitness-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
