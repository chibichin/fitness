import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./cloud-config.js?v=1.5.0";
import {mergeStates} from "./sync-core.js?v=1.5.0";
import {getSyncMeta,saveRemoteState} from "./storage.js?v=1.5.0";
import {getAllPhotos,getPhoto,putPhoto} from "./photo-store.js?v=1.5.0";

const SESSION_KEY="fitness-record-cloud-session-v1";
const OWNER_KEY="fitness-record-cloud-owner-v1";
const configured=Boolean(SUPABASE_URL&&SUPABASE_PUBLISHABLE_KEY);
let session=null,busy=false,queued=false,pollTimer=null,saveTimer=null;
let callbacks={getState:()=>null,applyState:()=>{},onStatus:()=>{}};

function status(kind,message){callbacks.onStatus({kind,message,signedIn:Boolean(session),configured})}
function rememberSession(value){
  session=value?{...value,expires_at:value.expires_at||Math.floor(Date.now()/1000)+(value.expires_in||3600)}:null;
  if(session)localStorage.setItem(SESSION_KEY,JSON.stringify(session));else localStorage.removeItem(SESSION_KEY);
}
function apiUrl(path){return `${SUPABASE_URL.replace(/\/$/,"")}${path}`}
async function rawRequest(path,{method="GET",body,token=session?.access_token,headers={}}={}){
  const response=await fetch(apiUrl(path),{method,headers:{apikey:SUPABASE_PUBLISHABLE_KEY,...(token?{Authorization:`Bearer ${token}`} :{}),...(body&&!((typeof Blob!=="undefined")&&body instanceof Blob)?{"Content-Type":"application/json"}:{}),...headers},body:body&&!(body instanceof Blob)?JSON.stringify(body):body});
  if(!response.ok){let detail="";try{const problem=await response.json();detail=problem.msg||problem.message||problem.error_description||problem.error||""}catch{}throw new Error(detail||`Cloud request failed (${response.status}).`)}
  if(response.status===204)return null;
  const type=response.headers.get("content-type")||"";
  return type.includes("json")?response.json():response.blob();
}
async function ensureSession(){
  if(!session)throw new Error("Sign in to sync.");
  if((session.expires_at||0)>Math.floor(Date.now()/1000)+60)return session;
  const refreshed=await rawRequest("/auth/v1/token?grant_type=refresh_token",{method:"POST",token:"",body:{refresh_token:session.refresh_token}});
  rememberSession(refreshed);return session;
}
async function request(path,options={}){await ensureSession();return rawRequest(path,options)}
async function cloudRow(){
  const rows=await request("/rest/v1/fitness_states?select=state,metadata,revision&limit=1",{headers:{Accept:"application/json"}});
  return rows?.[0]||null;
}
async function writeCloud(expected,state,metadata){
  return request("/rest/v1/rpc/sync_fitness_state",{method:"POST",body:{expected_revision:expected,next_state:state,next_metadata:metadata}});
}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b)}
async function uploadPhotos(state){
  const wanted=new Map((state.exercises||[]).filter(ex=>ex.photoId).map(ex=>[ex.photoId,String(ex.photoVersion||"")]));
  for(const record of await getAllPhotos()){
    if(!wanted.has(record.id)||(record.cloudVersion&&record.cloudVersion===wanted.get(record.id)))continue;
    const path=`/storage/v1/object/fitness-photos/${encodeURIComponent(session.user.id)}/${encodeURIComponent(record.id)}`;
    await request(path,{method:"PUT",body:record.blob,headers:{"Content-Type":record.blob.type||"image/jpeg","x-upsert":"true"}});
    await putPhoto(record.id,record.blob,{silent:true,cloudVersion:wanted.get(record.id)});
  }
}
async function downloadPhotos(state){
  for(const exercise of state.exercises||[]){
    if(!exercise.photoId)continue;
    const existing=await getPhoto(exercise.photoId),version=String(exercise.photoVersion||"");
    if(existing&&existing.cloudVersion===version)continue;
    try{
      const path=`/storage/v1/object/authenticated/fitness-photos/${encodeURIComponent(session.user.id)}/${encodeURIComponent(exercise.photoId)}`;
      const blob=await request(path);
      await putPhoto(exercise.photoId,blob,{silent:true,cloudVersion:version});
    }catch(error){console.error("Photo download failed",exercise.photoId,error)}
  }
}
async function runSync({initialize=false}={}){
  if(!configured){status("setup","Cloud setup is required before sync can start.");return}
  if(!session){status("signed-out","Sign in on this device to sync.");return}
  if(busy){queued=true;return}
  busy=true;status("working","Syncing…");
  try{
    let local=callbacks.getState(),localMeta=getSyncMeta(local),remote=await cloudRow();
    if(!remote&&!initialize){status("needs-initialization","Cloud is empty. On the computer with the official data, choose “Use this computer’s data”.");return}
    if(!remote){
      await uploadPhotos(local);
      remote=await writeCloud(0,local,localMeta);
    }
    if(remote&&localStorage.getItem(OWNER_KEY)!==session.user.id){
      saveRemoteState(remote.state,remote.metadata);await downloadPhotos(remote.state);callbacks.applyState(remote.state);
      localStorage.setItem(OWNER_KEY,session.user.id);
      status("synced",`Synced ${new Date().toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}`);return;
    }
    for(let attempt=0;attempt<3;attempt++){
      const merged=mergeStates(local,localMeta,remote.state,remote.metadata);
      if(same(merged.state,remote.state)&&same(merged.meta,remote.metadata)){
        saveRemoteState(merged.state,merged.meta);await downloadPhotos(merged.state);callbacks.applyState(merged.state);
        localStorage.setItem(OWNER_KEY,session.user.id);
        status("synced",`Synced ${new Date().toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}`);return;
      }
      await uploadPhotos(merged.state);
      const written=await writeCloud(Number(remote.revision)||0,merged.state,merged.meta);
      if(!written.applied){
        remote=written;local=merged.state;localMeta=merged.meta;continue;
      }
      saveRemoteState(written.state,written.metadata);await downloadPhotos(written.state);callbacks.applyState(written.state);
      localStorage.setItem(OWNER_KEY,session.user.id);
      status("synced",`Synced ${new Date().toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}`);return;
    }
    throw new Error("Another device kept changing the data. Sync will retry shortly.");
  }catch(error){console.error(error);status("error",error.message||"Sync failed. Local changes are saved and will retry.")}
  finally{busy=false;if(queued){queued=false;scheduleSync(300)}}
}
function scheduleSync(delay=700){clearTimeout(saveTimer);saveTimer=setTimeout(()=>runSync(),delay)}
function startPolling(){clearInterval(pollTimer);pollTimer=setInterval(()=>{if(document.visibilityState==="visible")runSync()},15000)}

export function cloudSyncInfo(){return {configured,signedIn:Boolean(session),email:session?.user?.email||""}}
export async function signUp(email,password){
  const redirectTo=new URL("./",window.location.href).href;
  const result=await rawRequest(`/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`,{method:"POST",token:"",body:{email,password}});
  if(result.access_token){rememberSession(result);await runSync()}
  else status("signed-out","Check your email to confirm the account, then sign in.");
}
export async function signIn(email,password){
  rememberSession(await rawRequest("/auth/v1/token?grant_type=password",{method:"POST",token:"",body:{email,password}}));
  startPolling();await runSync();
}
export async function signOut(){
  try{if(session)await rawRequest("/auth/v1/logout",{method:"POST"})}catch{}
  rememberSession(null);clearInterval(pollTimer);status("signed-out","Signed out. Sign in to view your workout data.");
}
export function initializeCloud(){return runSync({initialize:true})}
export function syncNow(){return runSync()}
export function initializeCloudSync(nextCallbacks){
  callbacks={...callbacks,...nextCallbacks};
  if(!configured){status("setup","Cloud setup is required before sync can start.");return}
  try{rememberSession(JSON.parse(localStorage.getItem(SESSION_KEY)))}catch{rememberSession(null)}
  globalThis.addEventListener("fitness-state-saved",()=>scheduleSync());
  globalThis.addEventListener("fitness-photo-changed",()=>scheduleSync());
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")runSync()});
  globalThis.addEventListener("online",()=>runSync());
  if(session){startPolling();runSync()}else status("signed-out","Sign in on this device to sync.");
}
