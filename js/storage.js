export const KEY="fitness-record-v1";
export function uid(){
  if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
  const bytes=new Uint8Array(16);
  if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(bytes);
  else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=[...bytes].map(x=>x.toString(16).padStart(2,"0"));
  return `${hex.slice(0,4).join("")}-${hex.slice(4,6).join("")}-${hex.slice(6,8).join("")}-${hex.slice(8,10).join("")}-${hex.slice(10).join("")}`;
}
export function makeDefaultState(){
  const exercises=[
    {id:uid(),name:"Knee Hug",category:"warmup",muscle:"Legs",photo:"",link:"",notes:"",archived:false},
    {id:uid(),name:"Hip Circle",category:"warmup",muscle:"Hips",photo:"",link:"",notes:"",archived:false},
    {id:uid(),name:"Squat",category:"strength",muscle:"Legs",photo:"",link:"",notes:"",archived:false},
    {id:uid(),name:"Bench Press",category:"strength",muscle:"Chest",photo:"",link:"",notes:"",archived:false},
    {id:uid(),name:"Bike",category:"cardio",muscle:"",photo:"",link:"",notes:"",archived:false},
    {id:uid(),name:"Hamstring Stretch",category:"flexibility",muscle:"Legs",photo:"",link:"",notes:"",archived:false}
  ];
  return {version:"1.3",exercises,plans:[],workouts:{},metrics:{},settings:{}};
}
export function loadState(){
  try{
    const s=JSON.parse(localStorage.getItem(KEY));
    if(!s)return makeDefaultState();
    s.version="1.3";s.exercises ||= [];s.plans ||= [];s.workouts ||= {};s.metrics ||= {};s.settings ||= {};
    s.exercises.forEach(x=>{x.archived ??= false;x.photo ||= "";x.link ||= "";x.notes ||= "";});
    s.plans = s.plans.map(p=>({
      ...p,
      items:[...(p.warmupAdditions||[]),...(p.items||[])].map(i=>({...i,exerciseName:i.exerciseName||s.exercises.find(e=>e.id===i.exerciseId)?.name||"Exercise"}))
    }));
    Object.values(s.workouts).forEach(w=>{
      w.planIds ||= [];w.items ||= [];
      w.items.forEach(i=>{
        i.exerciseName ||= s.exercises.find(e=>e.id===i.exerciseId)?.name||"Exercise";
        i.category ||= s.exercises.find(e=>e.id===i.exerciseId)?.category||"strength";
        i.type ||= i.category==="cardio"?"cardio":"exercise";
        if(i.type==="cardio"){
          i.intervals=(i.intervals||[]).map(interval=>{
            if(typeof interval==="number")return {minutes:interval,targetHr:i.targetHr||"",done:false};
            return {minutes:Number(interval.minutes)||10,targetHr:interval.targetHr??i.targetHr??"",done:Boolean(interval.done)};
          });
          if(!i.intervals.length)i.intervals=[{minutes:10,targetHr:"",done:false}];
          delete i.targetHr;
        }else{
          if(!Array.isArray(i.sets)){
            const count=Math.max(1,Number(i.sets)||1),reps=Number(i.reps)||1;
            i.sets=Array.from({length:count},()=>({weight:0,reps,done:false}));
          }
          if(!i.sets.length)i.sets=[{weight:0,reps:1,done:false}];
          i.sets=i.sets.map(set=>({weight:Number(set?.weight)||0,reps:Number(set?.reps)||0,done:Boolean(set?.done)}));
          delete i.reps;
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
