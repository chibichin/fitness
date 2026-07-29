function findScrollParent(element){
  let current=element.parentElement;
  while(current&&current!==document.body){
    const style=getComputedStyle(current);
    if(/auto|scroll/.test(style.overflowY)&&current.scrollHeight>current.clientHeight)return current;
    current=current.parentElement;
  }
  return document.scrollingElement||document.documentElement;
}

function scrollBounds(scrollParent){
  if(scrollParent===document.scrollingElement||scrollParent===document.documentElement||scrollParent===document.body){
    return {top:0,bottom:window.innerHeight};
  }
  const rect=scrollParent.getBoundingClientRect();
  return {top:Math.max(0,rect.top),bottom:Math.min(window.innerHeight,rect.bottom)};
}

function scrollByAmount(scrollParent,amount){
  if(!amount)return;
  if(scrollParent===document.scrollingElement||scrollParent===document.documentElement||scrollParent===document.body)window.scrollBy(0,amount);
  else scrollParent.scrollTop+=amount;
}

function restoreInlineStyles(element,styles){
  for(const [property,value] of Object.entries(styles))element.style[property]=value;
}

export function enableReorder({container,itemSelector,handleSelector,idAttribute,onCommit}){
  if(!container)return;
  const items=()=>[...container.children].filter(child=>child.matches(itemSelector));
  const orderedIds=()=>items().map(item=>item.dataset[idAttribute]).filter(Boolean);

  for(const handle of container.querySelectorAll(handleSelector)){
    handle.addEventListener("contextmenu",event=>event.preventDefault());
    handle.addEventListener("keydown",event=>{
      if(event.key!=="ArrowUp"&&event.key!=="ArrowDown")return;
      const item=handle.closest(itemSelector),ordered=items(),index=ordered.indexOf(item);
      const targetIndex=event.key==="ArrowUp"?index-1:index+1;
      if(index<0||targetIndex<0||targetIndex>=ordered.length)return;
      event.preventDefault();
      const target=ordered[targetIndex];
      if(event.key==="ArrowUp")container.insertBefore(item,target);
      else container.insertBefore(item,target.nextSibling);
      onCommit(orderedIds());
    });

    handle.addEventListener("pointerdown",downEvent=>{
      if(downEvent.button!==0||downEvent.isPrimary===false)return;
      const item=handle.closest(itemSelector),ordered=items();
      if(!item||ordered.length<2)return;

      downEvent.preventDefault();
      const pointerId=downEvent.pointerId,startY=downEvent.clientY,originalNextSibling=item.nextSibling;
      let pointerY=startY,dragging=false,placeholder=null,scrollFrame=0,finished=false;
      const scrollParent=findScrollParent(container);
      const originalStyles={
        position:item.style.position,
        left:item.style.left,
        top:item.style.top,
        width:item.style.width,
        height:item.style.height,
        margin:item.style.margin,
        transform:item.style.transform,
        zIndex:item.style.zIndex,
        pointerEvents:item.style.pointerEvents
      };

      const positionPlaceholder=()=>{
        const candidates=items().filter(candidate=>candidate!==item);
        let placed=false;
        for(const candidate of candidates){
          const rect=candidate.getBoundingClientRect();
          if(pointerY<rect.top+rect.height/2){
            if(placeholder.nextSibling!==candidate)container.insertBefore(placeholder,candidate);
            placed=true;
            break;
          }
        }
        if(!placed)container.appendChild(placeholder);
      };

      const autoScroll=()=>{
        if(!dragging)return;
        const bounds=scrollBounds(scrollParent),edge=Math.min(76,Math.max(42,(bounds.bottom-bounds.top)/4));
        let amount=0;
        if(pointerY<bounds.top+edge)amount=-Math.ceil(22*(bounds.top+edge-pointerY)/edge);
        else if(pointerY>bounds.bottom-edge)amount=Math.ceil(22*(pointerY-(bounds.bottom-edge))/edge);
        scrollByAmount(scrollParent,amount);
        if(amount)positionPlaceholder();
        scrollFrame=requestAnimationFrame(autoScroll);
      };

      const beginDrag=()=>{
        const rect=item.getBoundingClientRect(),computed=getComputedStyle(item);
        placeholder=document.createElement("div");
        placeholder.className="reorder-placeholder";
        placeholder.style.height=`${rect.height}px`;
        placeholder.style.marginTop=computed.marginTop;
        placeholder.style.marginBottom=computed.marginBottom;
        placeholder.setAttribute("aria-hidden","true");
        container.insertBefore(placeholder,item.nextSibling);
        Object.assign(item.style,{
          position:"fixed",
          left:`${rect.left}px`,
          top:`${rect.top}px`,
          width:`${rect.width}px`,
          height:`${rect.height}px`,
          margin:"0",
          transform:"translate3d(0,0,0)",
          zIndex:"1000",
          pointerEvents:"none"
        });
        item.classList.add("reorder-dragging");
        container.classList.add("reorder-active");
        document.body.classList.add("reordering");
        dragging=true;
        scrollFrame=requestAnimationFrame(autoScroll);
      };

      const move=moveEvent=>{
        if(moveEvent.pointerId!==pointerId)return;
        pointerY=moveEvent.clientY;
        if(!dragging&&Math.abs(pointerY-startY)<6)return;
        moveEvent.preventDefault();
        if(!dragging)beginDrag();
        item.style.transform=`translate3d(0,${pointerY-startY}px,0)`;
        positionPlaceholder();
      };

      const finish=(finishEvent,cancelled=false)=>{
        if(finished)return;
        if(finishEvent?.pointerId!==undefined&&finishEvent.pointerId!==pointerId)return;
        finished=true;
        window.removeEventListener("pointermove",move,true);
        window.removeEventListener("pointerup",endDrag,true);
        window.removeEventListener("pointercancel",cancelDrag,true);
        window.removeEventListener("blur",cancelDrag,true);
        cancelAnimationFrame(scrollFrame);
        if(!dragging)return;
        if(cancelled)container.insertBefore(item,originalNextSibling);
        else container.insertBefore(item,placeholder);
        placeholder.remove();
        item.classList.remove("reorder-dragging");
        container.classList.remove("reorder-active");
        document.body.classList.remove("reordering");
        restoreInlineStyles(item,originalStyles);
        if(!cancelled)onCommit(orderedIds());
      };
      const endDrag=event=>finish(event,false);
      const cancelDrag=event=>finish(event,true);

      window.addEventListener("pointermove",move,{passive:false,capture:true});
      window.addEventListener("pointerup",endDrag,true);
      window.addEventListener("pointercancel",cancelDrag,true);
      window.addEventListener("blur",cancelDrag,true);
    });
  }
}
