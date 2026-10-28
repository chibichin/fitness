export function scheduledPlanForDay(schedule,day){
  if(schedule?.mode==="same")return schedule.planId||"";
  if(schedule?.mode==="alternate"){
    const days=(schedule.days||[]).slice().sort((a,b)=>a-b),plans=schedule.rotationPlanIds||[];
    return days.includes(day)&&plans.length?plans[days.indexOf(day)%plans.length]:"";
  }
  return schedule?.assignments?.[day]||"";
}

export function scheduledPlanForDate(schedule,date){
  if(!schedule?.enabled)return "";
  if(schedule.overrides?.[date])return schedule.overrides[date];
  if(schedule.skippedDates?.[date])return "";
  const day=new Date(`${date}T12:00:00`).getDay();
  if(!(schedule.days||[]).includes(day))return "";
  return scheduledPlanForDay(schedule,day);
}
