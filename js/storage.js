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
    s.exercises ||= [];s.plans ||= [];s.workouts ||= {};s.metrics ||= {};s.settings ||= {};
    s.exercises.forEach(x=>{x.archived ??= false;x.photo ||= "";x.link ||= "";x.notes ||= "";});
    s.plans = s.plans.map(p=>({
      ...p,
      items:[...(p.warmupAdditions||[]),...(p.items||[])].map(i=>({...i,exerciseName:i.exerciseName||s.exercises.find(e=>e.id===i.exerciseId)?.name||"Exercise"}))
    }));
    Object.values(s.workouts).forEach(w=>{
      w.planIds ||= [];w.items ||= [];
      w.items.forEach(i=>{i.exerciseName ||= s.exercises.find(e=>e.id===i.exerciseId)?.name||"Exercise";});
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
