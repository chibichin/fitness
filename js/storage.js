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
export function loadState(){
  try{
    const s=JSON.parse(localStorage.getItem(KEY));
    if(!s)return makeDefaultState();
    s.version="1.1";s.exercises ||= [];s.plans ||= [];s.workouts ||= {};s.metrics ||= {};s.settings ||= {};
    s.exercises.forEach(x=>{x.archived ??= false;x.photo ||= "";x.link ||= "";x.notes ||= "";});
    s.plans = s.plans.map(p=>({
      ...p,
      items:[...(p.warmupAdditions||[]),...(p.items||[])].map(i=>({...i,exerciseName:i.exerciseName||s.exercises.find(e=>e.id===i.exerciseId)?.name||"Exercise"}))
    }));
    Object.values(s.workouts).forEach(w=>{
      w.planIds ||= [];w.items ||= [];
      w.items.forEach(i=>{
        i.exerciseName ||= s.exercises.find(e=>e.id===i.exerciseId)?.name||"Exercise";
        if(i.type==="cardio"){
          i.intervals=(i.intervals||[]).map(interval=>{
            if(typeof interval==="number")return {minutes:interval,targetHr:i.targetHr||"",done:false};
            return {minutes:Number(interval.minutes)||10,targetHr:interval.targetHr??i.targetHr??"",done:Boolean(interval.done)};
          });
          if(!i.intervals.length)i.intervals=[{minutes:10,targetHr:"",done:false}];
          delete i.targetHr;
        }
        if(!i.sourcePlanId&&w.planIds.length){
          const matches=w.planIds.map(id=>s.plans.find(p=>p.id===id)).filter(p=>p&&(p.items||[]).some(item=>item.exerciseId===i.exerciseId));
          if(matches.length===1){i.sourcePlanId=matches[0].id;i.sourcePlanName=matches[0].name;const sourceItem=(matches[0].items||[]).find(item=>item.exerciseId===i.exerciseId);if(sourceItem)i.sourcePlanItemId=sourceItem.id;}
        }
        if(i.sourcePlanId&&!i.sourcePlanName)i.sourcePlanName=s.plans.find(p=>p.id===i.sourcePlanId)?.name||"Plan";
      });
    });
    return s;
  }catch{return makeDefaultState()}
}
export function saveState(s){localStorage.setItem(KEY,JSON.stringify(s))}
export function downloadBackup(s){
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([JSON.stringify(s,null,2)],{type:"application/json"}));
  a.download=`fitness-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
