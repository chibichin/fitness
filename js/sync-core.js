const COLLECTIONS=["exercises","plans"];
const MAPS=["metrics"];

function clone(value){return structuredClone(value)}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b)}
function nextStamp(meta,now=Date.now()){
  const next=Math.max(Number(now)||0,(Number(meta.clock)||0)+1);
  meta.clock=next;
  return `${String(next).padStart(16,"0")}:${meta.deviceId}`;
}
function blankMeta(deviceId="device"){
  return {deviceId,clock:0,exercises:{},plans:{},workouts:{},metrics:{},settings:{stamp:"",deleted:false}};
}
function byId(values=[]){return new Map(values.map(value=>[value.id,value]))}

export function createSyncMeta(state,deviceId,now=Date.now()){
  const meta=blankMeta(deviceId);
  for(const name of COLLECTIONS)for(const value of state[name]||[])meta[name][value.id]={stamp:nextStamp(meta,now),deleted:false};
  for(const name of MAPS)for(const key of Object.keys(state[name]||{}))meta[name][key]={stamp:nextStamp(meta,now),deleted:false};
  for(const [date,workout] of Object.entries(state.workouts||{})){
    const stamp=nextStamp(meta,now),items={};
    for(const item of workout.items||[])items[item.id]={stamp,deleted:false};
    meta.workouts[date]={stamp,fieldsStamp:stamp,deleted:false,items};
  }
  meta.settings={stamp:nextStamp(meta,now),deleted:false};
  return meta;
}

export function recordStateChanges(previous,next,currentMeta,deviceId,now=Date.now()){
  const meta=clone(currentMeta?.deviceId?currentMeta:blankMeta(deviceId));
  meta.deviceId=deviceId;
  for(const name of COLLECTIONS){
    const before=byId(previous?.[name]),after=byId(next?.[name]);
    for(const id of new Set([...before.keys(),...after.keys()])){
      if(same(before.get(id),after.get(id)))continue;
      meta[name][id]={stamp:nextStamp(meta,now),deleted:!after.has(id)};
    }
  }
  for(const name of MAPS){
    const before=previous?.[name]||{},after=next?.[name]||{};
    for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
      if(same(before[key],after[key]))continue;
      meta[name][key]={stamp:nextStamp(meta,now),deleted:!(key in after)};
    }
  }
  const beforeWorkouts=previous?.workouts||{},afterWorkouts=next?.workouts||{};
  for(const date of new Set([...Object.keys(beforeWorkouts),...Object.keys(afterWorkouts)])){
    const before=beforeWorkouts[date],after=afterWorkouts[date],existing=meta.workouts[date]||{stamp:"",fieldsStamp:"",deleted:false,items:{}};
    existing.items||={};existing.fieldsStamp||=existing.stamp||"";
    if(!after){const stamp=nextStamp(meta,now);meta.workouts[date]={...existing,stamp,deleted:true};continue}
    if(!before){
      const stamp=nextStamp(meta,now),items={};
      for(const item of after.items||[])items[item.id]={stamp,deleted:false};
      meta.workouts[date]={stamp,fieldsStamp:stamp,deleted:false,items};continue;
    }
    let changed=false;
    if(!same({...before,items:undefined},{...after,items:undefined})){
      existing.fieldsStamp=nextStamp(meta,now);changed=true;
    }
    const beforeItems=byId(before.items),afterItems=byId(after.items);
    for(const id of new Set([...beforeItems.keys(),...afterItems.keys()])){
      if(same(beforeItems.get(id),afterItems.get(id)))continue;
      existing.items[id]={stamp:nextStamp(meta,now),deleted:!afterItems.has(id)};changed=true;
    }
    if(changed)existing.stamp=nextStamp(meta,now);
    existing.deleted=false;meta.workouts[date]=existing;
  }
  if(!same(previous?.settings||{},next?.settings||{}))meta.settings={stamp:nextStamp(meta,now),deleted:false};
  return meta;
}

function winner(localValue,localEntry,remoteValue,remoteEntry){
  const localStamp=localEntry?.stamp||"",remoteStamp=remoteEntry?.stamp||"";
  if(remoteStamp>localStamp)return {value:remoteValue,entry:remoteEntry};
  return {value:localValue,entry:localEntry};
}

export function mergeStates(localState,localMeta,remoteState,remoteMeta){
  const state={version:"1.5.0",exercises:[],plans:[],workouts:{},metrics:{},settings:{}},meta=blankMeta(localMeta?.deviceId||"device");
  meta.clock=Math.max(Number(localMeta?.clock)||0,Number(remoteMeta?.clock)||0);
  for(const name of COLLECTIONS){
    const local=byId(localState?.[name]),remote=byId(remoteState?.[name]);
    for(const id of new Set([...Object.keys(localMeta?.[name]||{}),...Object.keys(remoteMeta?.[name]||{}),...local.keys(),...remote.keys()])){
      const picked=winner(local.get(id),localMeta?.[name]?.[id],remote.get(id),remoteMeta?.[name]?.[id]);
      if(picked.entry)meta[name][id]=clone(picked.entry);
      if(!picked.entry?.deleted&&picked.value)state[name].push(clone(picked.value));
    }
  }
  for(const name of MAPS){
    const local=localState?.[name]||{},remote=remoteState?.[name]||{};
    for(const key of new Set([...Object.keys(localMeta?.[name]||{}),...Object.keys(remoteMeta?.[name]||{}),...Object.keys(local),...Object.keys(remote)])){
      const picked=winner(local[key],localMeta?.[name]?.[key],remote[key],remoteMeta?.[name]?.[key]);
      if(picked.entry)meta[name][key]=clone(picked.entry);
      if(!picked.entry?.deleted&&picked.value!==undefined)state[name][key]=clone(picked.value);
    }
  }
  const localWorkouts=localState?.workouts||{},remoteWorkouts=remoteState?.workouts||{};
  for(const date of new Set([...Object.keys(localMeta?.workouts||{}),...Object.keys(remoteMeta?.workouts||{}),...Object.keys(localWorkouts),...Object.keys(remoteWorkouts)])){
    const localEntry=normalizeWorkoutMeta(localMeta?.workouts?.[date],localWorkouts[date]);
    const remoteEntry=normalizeWorkoutMeta(remoteMeta?.workouts?.[date],remoteWorkouts[date]);
    const latest=winner(localWorkouts[date],localEntry,remoteWorkouts[date],remoteEntry);
    if(latest.entry?.deleted){meta.workouts[date]=clone(latest.entry);continue}
    const localWorkout=localWorkouts[date]||{},remoteWorkout=remoteWorkouts[date]||{};
    const fields=winner(localWorkout, {stamp:localEntry.fieldsStamp}, remoteWorkout, {stamp:remoteEntry.fieldsStamp}).value||{};
    const workout={...clone(fields),items:[]},entry={stamp:localEntry.stamp>remoteEntry.stamp?localEntry.stamp:remoteEntry.stamp,fieldsStamp:localEntry.fieldsStamp>remoteEntry.fieldsStamp?localEntry.fieldsStamp:remoteEntry.fieldsStamp,deleted:false,items:{}};
    const localItems=byId(localWorkout.items),remoteItems=byId(remoteWorkout.items);
    for(const id of new Set([...Object.keys(localEntry.items),...Object.keys(remoteEntry.items),...localItems.keys(),...remoteItems.keys()])){
      const picked=winner(localItems.get(id),localEntry.items[id],remoteItems.get(id),remoteEntry.items[id]);
      if(picked.entry)entry.items[id]=clone(picked.entry);
      if(!picked.entry?.deleted&&picked.value)workout.items.push(clone(picked.value));
    }
    state.workouts[date]=workout;meta.workouts[date]=entry;
  }
  const settings=winner(localState?.settings||{},localMeta?.settings,remoteState?.settings||{},remoteMeta?.settings);
  state.settings=clone(settings.value||{});meta.settings=clone(settings.entry||{stamp:"",deleted:false});
  return {state,meta};
}

function normalizeWorkoutMeta(entry={},workout={}){
  const normalized={stamp:entry?.stamp||"",fieldsStamp:entry?.fieldsStamp||entry?.stamp||"",deleted:Boolean(entry?.deleted),items:clone(entry?.items||{})};
  for(const item of workout?.items||[])normalized.items[item.id]||={stamp:normalized.stamp,deleted:false};
  return normalized;
}
