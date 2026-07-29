const DB_NAME="fitness-record-photo-storage";
const DB_VERSION=1;
const STORE_NAME="photos";

let databasePromise=null;

function openDatabase(){
  if(!("indexedDB" in globalThis))return Promise.reject(new Error("Photo storage is not supported in this browser."));
  if(databasePromise)return databasePromise;
  databasePromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const database=request.result;
      if(!database.objectStoreNames.contains(STORE_NAME))database.createObjectStore(STORE_NAME,{keyPath:"id"});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error("Photo storage could not be opened."));
    request.onblocked=()=>reject(new Error("Photo storage is busy in another app window."));
  });
  return databasePromise;
}

function finishTransaction(transaction){
  return new Promise((resolve,reject)=>{
    transaction.oncomplete=()=>resolve();
    transaction.onerror=()=>reject(transaction.error||new Error("Photo storage failed."));
    transaction.onabort=()=>reject(transaction.error||new Error("Photo storage was cancelled."));
  });
}

export async function putPhoto(id,blob){
  if(!id||!(blob instanceof Blob))throw new Error("The photo could not be saved.");
  const database=await openDatabase();
  const transaction=database.transaction(STORE_NAME,"readwrite");
  transaction.objectStore(STORE_NAME).put({
    id:String(id),
    blob,
    size:blob.size,
    type:blob.type||"image/jpeg",
    updatedAt:new Date().toISOString()
  });
  await finishTransaction(transaction);
}

export async function getPhoto(id){
  if(!id)return null;
  const database=await openDatabase();
  return new Promise((resolve,reject)=>{
    const request=database.transaction(STORE_NAME,"readonly").objectStore(STORE_NAME).get(String(id));
    request.onsuccess=()=>resolve(request.result||null);
    request.onerror=()=>reject(request.error||new Error("The photo could not be loaded."));
  });
}

export async function getAllPhotos(){
  const database=await openDatabase();
  return new Promise((resolve,reject)=>{
    const store=database.transaction(STORE_NAME,"readonly").objectStore(STORE_NAME);
    if(typeof store.getAll==="function"){
      const request=store.getAll();
      request.onsuccess=()=>resolve(request.result||[]);
      request.onerror=()=>reject(request.error||new Error("Photos could not be loaded."));
      return;
    }
    const records=[];
    const request=store.openCursor();
    request.onsuccess=()=>{
      const cursor=request.result;
      if(!cursor)return resolve(records);
      records.push(cursor.value);
      cursor.continue();
    };
    request.onerror=()=>reject(request.error||new Error("Photos could not be loaded."));
  });
}

export async function deletePhoto(id){
  if(!id)return;
  const database=await openDatabase();
  const transaction=database.transaction(STORE_NAME,"readwrite");
  transaction.objectStore(STORE_NAME).delete(String(id));
  await finishTransaction(transaction);
}

export async function clearPhotos(){
  const database=await openDatabase();
  const transaction=database.transaction(STORE_NAME,"readwrite");
  transaction.objectStore(STORE_NAME).clear();
  await finishTransaction(transaction);
}

export async function replaceAllPhotos(entries){
  const database=await openDatabase();
  const transaction=database.transaction(STORE_NAME,"readwrite");
  const store=transaction.objectStore(STORE_NAME);
  store.clear();
  for(const entry of entries){
    if(!entry?.id||!(entry.blob instanceof Blob))continue;
    store.put({
      id:String(entry.id),
      blob:entry.blob,
      size:entry.blob.size,
      type:entry.blob.type||"image/jpeg",
      updatedAt:new Date().toISOString()
    });
  }
  await finishTransaction(transaction);
}

export async function photoStorageStats(){
  const records=await getAllPhotos();
  return {
    count:records.length,
    bytes:records.reduce((sum,record)=>sum+(Number(record.size)||record.blob?.size||0),0)
  };
}

export function blobToDataUrl(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||""));
    reader.onerror=()=>reject(reader.error||new Error("The photo could not be exported."));
    reader.readAsDataURL(blob);
  });
}

export async function requestPersistentPhotoStorage(){
  try{
    if(navigator.storage?.persist)return Boolean(await navigator.storage.persist());
  }catch{}
  return false;
}
