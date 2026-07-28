export const PHOTO_MAX_DATA_URL_CHARS=280000;
const PHOTO_MAX_DIMENSION=1200;
const JPEG_QUALITIES=[0.82,0.74,0.66,0.58,0.5];

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

function renderJpeg(image,width,height,quality){
  const canvas=document.createElement("canvas");
  canvas.width=width;
  canvas.height=height;
  const context=canvas.getContext("2d");
  if(!context)throw new Error("Photo compression is not supported in this browser.");
  context.fillStyle="#fff";
  context.fillRect(0,0,width,height);
  context.drawImage(image,0,0,width,height);
  return canvas.toDataURL("image/jpeg",quality);
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

export async function compressPhotoDataUrl(dataUrl){
  const original=String(dataUrl||"");
  if(!original.startsWith("data:image/"))throw new Error("The selected file is not a supported image.");
  const originalBytes=dataUrlBinaryBytes(original);
  if(original.length<=PHOTO_MAX_DATA_URL_CHARS){
    return {dataUrl:original,originalBytes,compressedBytes:originalBytes,changed:false};
  }

  const image=await loadImage(original);
  const sourceWidth=image.naturalWidth||image.width;
  const sourceHeight=image.naturalHeight||image.height;
  if(!sourceWidth||!sourceHeight)throw new Error("The photo dimensions could not be read.");

  const initialScale=Math.min(1,PHOTO_MAX_DIMENSION/Math.max(sourceWidth,sourceHeight));
  let width=Math.max(1,Math.round(sourceWidth*initialScale));
  let height=Math.max(1,Math.round(sourceHeight*initialScale));
  let best=original;

  for(let sizeAttempt=0;sizeAttempt<6;sizeAttempt++){
    for(const quality of JPEG_QUALITIES){
      const candidate=renderJpeg(image,width,height,quality);
      if(candidate.length<best.length)best=candidate;
      if(candidate.length<=PHOTO_MAX_DATA_URL_CHARS){
        return {
          dataUrl:candidate,
          originalBytes,
          compressedBytes:dataUrlBinaryBytes(candidate),
          changed:candidate!==original
        };
      }
    }
    width=Math.max(1,Math.round(width*.82));
    height=Math.max(1,Math.round(height*.82));
  }

  return {
    dataUrl:best,
    originalBytes,
    compressedBytes:dataUrlBinaryBytes(best),
    changed:best!==original
  };
}

export async function compressPhotoFile(file){
  if(!file||!String(file.type||"").startsWith("image/"))throw new Error("Select an image file.");
  return compressPhotoDataUrl(await readAsDataUrl(file));
}

export async function compressStatePhotos(state){
  const exercises=Array.isArray(state?.exercises)?state.exercises:[];
  let optimized=0;
  let originalBytes=0;
  let compressedBytes=0;
  for(const exercise of exercises){
    const photo=String(exercise?.photo||"");
    if(!photo.startsWith("data:image/")||photo.length<=PHOTO_MAX_DATA_URL_CHARS)continue;
    const result=await compressPhotoDataUrl(photo);
    if(!result.changed)continue;
    exercise.photo=result.dataUrl;
    optimized++;
    originalBytes+=result.originalBytes;
    compressedBytes+=result.compressedBytes;
  }
  return {optimized,originalBytes,compressedBytes,savedBytes:Math.max(0,originalBytes-compressedBytes)};
}
