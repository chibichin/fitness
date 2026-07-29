export const PHOTO_MAX_DIMENSION=2048;
export const PHOTO_TARGET_BYTES=1400000;
const JPEG_QUALITIES=[0.9,0.86,0.82,0.78];

function readAsDataUrl(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||""));
    reader.onerror=()=>reject(reader.error||new Error("The photo could not be read."));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src){
  return new Promise((resolve,reject)=>{
    const image=new Image();
    image.onload=()=>resolve(image);
    image.onerror=()=>reject(new Error("This image format could not be prepared. Try a JPEG or PNG photo."));
    image.src=src;
  });
}

function renderJpegBlob(image,width,height,quality){
  return new Promise((resolve,reject)=>{
    const canvas=document.createElement("canvas");
    canvas.width=width;
    canvas.height=height;
    const context=canvas.getContext("2d");
    if(!context)return reject(new Error("Photo compression is not supported in this browser."));
    context.imageSmoothingEnabled=true;
    context.imageSmoothingQuality="high";
    context.fillStyle="#fff";
    context.fillRect(0,0,width,height);
    context.drawImage(image,0,0,width,height);
    canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("The photo could not be compressed.")),"image/jpeg",quality);
  });
}

function dataUrlToBlob(dataUrl){
  const [header,payload=""]=String(dataUrl||"").split(",",2);
  const type=header.match(/^data:([^;,]+)/)?.[1]||"application/octet-stream";
  const binary=header.includes(";base64")?atob(payload):decodeURIComponent(payload);
  const bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
  return new Blob([bytes],{type});
}

export function dataUrlBinaryBytes(dataUrl){
  const comma=String(dataUrl||"").indexOf(",");
  if(comma<0)return 0;
  const payload=dataUrl.slice(comma+1);
  if(dataUrl.slice(0,comma).includes(";base64")){
    const padding=payload.endsWith("==")?2:payload.endsWith("=")?1:0;
    return Math.max(0,Math.floor(payload.length*3/4)-padding);
  }
  try{return new TextEncoder().encode(decodeURIComponent(payload)).length}catch{return payload.length}
}

export function formatBytes(bytes){
  const value=Math.max(0,Number(bytes)||0);
  if(value<1024)return `${Math.round(value)} B`;
  if(value<1024*1024)return `${Math.round(value/1024)} KB`;
  return `${(value/(1024*1024)).toFixed(value<10*1024*1024?1:0)} MB`;
}

async function optimizePhotoBlob(sourceBlob){
  if(!(sourceBlob instanceof Blob)||!String(sourceBlob.type||"").startsWith("image/"))throw new Error("Select an image file.");
  const sourceUrl=await readAsDataUrl(sourceBlob);
  const image=await loadImage(sourceUrl);
  const sourceWidth=image.naturalWidth||image.width;
  const sourceHeight=image.naturalHeight||image.height;
  if(!sourceWidth||!sourceHeight)throw new Error("The photo dimensions could not be read.");

  const longest=Math.max(sourceWidth,sourceHeight);
  const supportedOriginal=/^image\/(jpeg|png|webp)$/i.test(sourceBlob.type||"");
  if(supportedOriginal&&longest<=PHOTO_MAX_DIMENSION&&sourceBlob.size<=PHOTO_TARGET_BYTES){
    return {
      blob:sourceBlob,
      originalBytes:sourceBlob.size,
      compressedBytes:sourceBlob.size,
      width:sourceWidth,
      height:sourceHeight,
      changed:false
    };
  }

  const initialScale=Math.min(1,PHOTO_MAX_DIMENSION/longest);
  let width=Math.max(1,Math.round(sourceWidth*initialScale));
  let height=Math.max(1,Math.round(sourceHeight*initialScale));
  let best=null;

  for(let sizeAttempt=0;sizeAttempt<4;sizeAttempt++){
    for(const quality of JPEG_QUALITIES){
      const candidate=await renderJpegBlob(image,width,height,quality);
      if(!best||candidate.size<best.blob.size)best={blob:candidate,width,height};
      if(candidate.size<=PHOTO_TARGET_BYTES){
        return {
          blob:candidate,
          originalBytes:sourceBlob.size,
          compressedBytes:candidate.size,
          width,
          height,
          changed:true
        };
      }
    }
    width=Math.max(1,Math.round(width*.88));
    height=Math.max(1,Math.round(height*.88));
  }

  return {
    blob:best.blob,
    originalBytes:sourceBlob.size,
    compressedBytes:best.blob.size,
    width:best.width,
    height:best.height,
    changed:true
  };
}

export function compressPhotoFile(file){
  return optimizePhotoBlob(file);
}

export function compressPhotoDataUrl(dataUrl){
  const value=String(dataUrl||"");
  if(!value.startsWith("data:image/"))throw new Error("The backup contains an unsupported photo.");
  return optimizePhotoBlob(dataUrlToBlob(value));
}
