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
function normalizeWorkoutCardio(item){
  if(item.type!=="cardio")return;
  const sharedHeartRate=item.targetHr??"";
  item.intervals=(item.intervals||[10]).map(interval=>{
    if(typeof interval==="number")return {minutes:interval,heartRate:sharedHeartRate,done:false};
    return {
      ...interval,
      minutes:Number(interval.minutes)||1,
      heartRate:interval.heartRate??interval.targetHr??sharedHeartRate,
      done:Boolean(interval.done)
    };
  });
  delete item.targetHr;
}
function attachLegacyPlanSources(state,workout){
  const claimed=new Set(workout.items.filter(item=>item.sourcePlanId).map(item=>item.id));
  for(const planId of workout.planIds){
    const plan=state.plans.find(candidate=>candidate.id===planId);
    if(!plan)continue;
    (plan.items||[]).forEach((planItem,sourcePlanOrder)=>{
      const match=workout.items.find(item=>!claimed.has(item.id)&&!item.sourcePlanId&&item.exerciseId===planItem.exerciseId);
      if(!match)return;
      match.sourcePlanId=plan.id;
      match.sourcePlanName=plan.name;
      match.sourcePlanItemId=planItem.id;
      match.sourcePlanOrder=sourcePlanOrder;
      claimed.add(match.id);
    });
  }
  workout.items.forEach(item=>{
    if(!item.sourcePlanId)return;
    const plan=state.plans.find(candidate=>candidate.id===item.sourcePlanId);
    item.sourcePlanName ||= plan?.name||"Saved plan";
    if(item.sourcePlanOrder==null&&plan){
      const index=(plan.items||[]).findIndex(planItem=>planItem.id===item.sourcePlanItemId||planItem.exerciseId===item.exerciseId);
      if(index>=0)item.sourcePlanOrder=index;
    }
  });
}
export function loadState(){
  try{
    const state=JSON.parse(localStorage.getItem(KEY));
    if(!state)return makeDefaultState();
    state.exercises ||= [];state.plans ||= [];state.workouts ||= {};state.metrics ||= {};state.settings ||= {};
    state.exercises.forEach(exercise=>{exercise.archived ??= false;exercise.photo ||= "";exercise.link ||= "";exercise.notes ||= "";});
    state.plans=state.plans.map(plan=>{
      const {warmupAdditions,...record}=plan,seen=new Set();
      const items=[...(warmupAdditions||[]),...(plan.items||[])].filter(item=>{const key=item.id||`${item.exerciseId}-${item.category}`;if(seen.has(key))return false;seen.add(key);return true;}).map(item=>({...item,exerciseName:item.exerciseName||state.exercises.find(exercise=>exercise.id===item.exerciseId)?.name||"Exercise"}));
      return {...record,items};
    });
    Object.values(state.workouts).forEach(workout=>{
      workout.planIds=[...new Set(workout.planIds||[])];workout.items ||= [];
      workout.items.forEach(item=>{
        item.exerciseName ||= state.exercises.find(exercise=>exercise.id===item.exerciseId)?.name||"Exercise";
        normalizeWorkoutCardio(item);
      });
      attachLegacyPlanSources(state,workout);
    });
    state.version="1.1";
    return state;
  }catch{return makeDefaultState()}
}
export function saveState(state){localStorage.setItem(KEY,JSON.stringify(state))}
export function downloadBackup(state){
  const link=document.createElement("a");
  link.href=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:"application/json"}));
  link.download=`fitness-backup-${new Date().toISOString().slice(0,10)}.json`;link.click();
  setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}
