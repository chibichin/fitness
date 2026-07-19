const XLSX_MIME="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function xmlEscape(value){
  return String(value??"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&apos;");
}

function columnName(index){
  let name="";
  for(let n=index;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+((n-1)%26))+name;
  return name;
}

function cellXml(row,column,value,style=0){
  const ref=`${columnName(column)}${row}`;
  if(value===null||value===undefined||value==="")return `<c r="${ref}" s="${style}"/>`;
  if(typeof value==="number"&&Number.isFinite(value))return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  const text=String(value);
  const preserve=/^\s|\s$|\n/.test(text)?' xml:space="preserve"':"";
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t${preserve}>${xmlEscape(text)}</t></is></c>`;
}

function rowXml(index,height,cells){
  return `<row r="${index}" ht="${height}" customHeight="1">${cells.join("")}</row>`;
}

function gridRow(index,height,values,styles={}){
  const cells=[];
  for(let column=1;column<=11;column++)cells.push(cellXml(index,column,values[column-1]??"",styles[column]??styles.default??7));
  return rowXml(index,height,cells);
}

function activityRow(index,row,dateCount,{boldMarks=false,small=false}={}){
  const values=[row?.name||"",row?.detail||""];
  for(let slot=0;slot<9;slot++)values.push(slot<dateCount?(row?.values?.[slot]??""):"");
  const styles={1:7,2:8,default:small?10:(boldMarks?9:8)};
  return gridRow(index,18,values,styles);
}

function worksheetXml(report,page,pageIndex){
  const dates=report.dates||[],dateCount=Math.min(dates.length,9),rows=[];
  rows.push(rowXml(1,27,[cellXml(1,1,"Canada College",1)]));
  rows.push(rowXml(2,18,[cellXml(2,1,"Professor R. Marquez",2),cellXml(2,9,report.pages.length>1?`Page ${pageIndex+1} of ${report.pages.length}`:"",11)]));
  rows.push(rowXml(3,18,[cellXml(3,1,"Student:",2),cellXml(3,2,report.student||"",3)]));
  rows.push(rowXml(4,24,[cellXml(4,1,"Goals:",3),cellXml(4,2,report.goals||"",3)]));
  rows.push(rowXml(5,10,[]));

  const warmHeader=["WARM-EXERCISES","Reps"];
  for(let slot=0;slot<9;slot++)warmHeader.push(slot<dateCount?dates[slot].label:"");
  rows.push(gridRow(6,20,warmHeader,{1:4,2:5,default:6}));
  for(let index=0;index<11;index++)rows.push(activityRow(7+index,page.warmup[index],dateCount,{boldMarks:true}));

  rows.push(gridRow(18,20,["STRENGTH","Sets/Reps","","","","","","","","",""] ,{1:4,2:5,default:8}));
  for(let index=0;index<12;index++)rows.push(activityRow(19+index,page.strength[index],dateCount));

  rows.push(gridRow(31,20,["CARDIOVASCULAR","",...(page.cardio?.names||[])],{1:4,2:8,default:10}));
  rows.push(gridRow(32,20,["Target Heart Rate Range","",...(page.cardio?.heartRates||[])],{1:7,2:8,default:8}));
  rows.push(gridRow(33,20,["Duration (min)","",...(page.cardio?.minutes||[])],{1:7,2:8,default:8}));

  rows.push(gridRow(34,20,["FLEXIBILITY","","","","","","","","","",""] ,{1:4,2:8,default:8}));
  for(let index=0;index<3;index++)rows.push(activityRow(35+index,page.flexibility[index],dateCount,{boldMarks:true}));

  const merges=["A1:D1","A2:D2","I2:K2","B3:E3","B4:K4"];
  const cols=['<col min="1" max="1" width="29" customWidth="1"/>','<col min="2" max="2" width="9" customWidth="1"/>','<col min="3" max="11" width="10.7" customWidth="1"/>'].join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:K37"/>
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${cols}</cols>
  <sheetData>${rows.join("")}</sheetData>
  <mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join("")}</mergeCells>
  <printOptions horizontalCentered="1" verticalCentered="0"/>
  <pageMargins left="0.35" right="0.35" top="0.35" bottom="0.35" header="0" footer="0"/>
  <pageSetup paperSize="1" orientation="landscape" fitToWidth="1" fitToHeight="1" horizontalDpi="300" verticalDpi="300"/>
</worksheet>`;
}

function stylesXml(){
  const thin='<border><left style="thin"><color rgb="FF333333"/></left><right style="thin"><color rgb="FF333333"/></right><top style="thin"><color rgb="FF333333"/></top><bottom style="thin"><color rgb="FF333333"/></bottom><diagonal/></border>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="5">
    <font><sz val="10"/><name val="Times New Roman"/><family val="1"/></font>
    <font><b/><sz val="16"/><name val="Times New Roman"/><family val="1"/></font>
    <font><b/><sz val="10"/><name val="Times New Roman"/><family val="1"/></font>
    <font><sz val="9"/><name val="Times New Roman"/><family val="1"/></font>
    <font><i/><color rgb="FF666666"/><sz val="9"/><name val="Times New Roman"/><family val="1"/></font>
  </fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${thin}</borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="12">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" shrinkToFit="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function workbookXml(sheetNames){
  const sheets=sheetNames.map((name,index)=>`<sheet name="${xmlEscape(name)}" sheetId="${index+1}" r:id="rId${index+1}"/>`).join("");
  const printAreas=sheetNames.map((name,index)=>`<definedName name="_xlnm.Print_Area" localSheetId="${index}">'${name.replace(/'/g,"''")}'!$A$1:$K$37</definedName>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="14000"/></bookViews>
  <sheets>${sheets}</sheets>
  <definedNames>${printAreas}</definedNames>
  <calcPr calcId="0" fullCalcOnLoad="1"/>
</workbook>`;
}

function workbookRelsXml(sheetCount){
  const relationships=[];
  for(let index=0;index<sheetCount;index++)relationships.push(`<Relationship Id="rId${index+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index+1}.xml"/>`);
  relationships.push(`<Relationship Id="rId${sheetCount+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join("")}</Relationships>`;
}

function contentTypesXml(sheetCount){
  const sheets=Array.from({length:sheetCount},(_,index)=>`<Override PartName="/xl/worksheets/sheet${index+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

function rootRelsXml(){
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function appPropsXml(sheetNames){
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Fitness Record</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheetNames.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${sheetNames.length}" baseType="lpstr">${sheetNames.map(name=>`<vt:lpstr>${xmlEscape(name)}</vt:lpstr>`).join("")}</vt:vector></TitlesOfParts><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.4</AppVersion></Properties>`;
}

function corePropsXml(){
  const now=new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Canada Workout Program Weekly</dc:title><dc:creator>Fitness Record</dc:creator><cp:lastModifiedBy>Fitness Record</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

function crc32(bytes){
  let crc=0xffffffff;
  for(const byte of bytes){
    crc^=byte;
    for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}

function push16(target,value){target.push(value&255,(value>>>8)&255)}
function push32(target,value){target.push(value&255,(value>>>8)&255,(value>>>16)&255,(value>>>24)&255)}
function dosDateTime(date=new Date()){
  const year=Math.max(1980,date.getFullYear());
  return {
    time:(date.getHours()<<11)|(date.getMinutes()<<5)|(Math.floor(date.getSeconds()/2)),
    date:((year-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate()
  };
}

function zipStore(files){
  const encoder=new TextEncoder(),chunks=[],central=[];
  let offset=0;
  const stamp=dosDateTime();
  for(const file of files){
    const name=encoder.encode(file.name),data=typeof file.data==="string"?encoder.encode(file.data):file.data,crc=crc32(data),local=[];
    push32(local,0x04034b50);push16(local,20);push16(local,0x0800);push16(local,0);push16(local,stamp.time);push16(local,stamp.date);push32(local,crc);push32(local,data.length);push32(local,data.length);push16(local,name.length);push16(local,0);
    local.push(...name);
    chunks.push(new Uint8Array(local),data);
    const entry=[];
    push32(entry,0x02014b50);push16(entry,20);push16(entry,20);push16(entry,0x0800);push16(entry,0);push16(entry,stamp.time);push16(entry,stamp.date);push32(entry,crc);push32(entry,data.length);push32(entry,data.length);push16(entry,name.length);push16(entry,0);push16(entry,0);push16(entry,0);push16(entry,0);push32(entry,0);push32(entry,offset);entry.push(...name);
    central.push(new Uint8Array(entry));
    offset+=local.length+data.length;
  }
  const centralOffset=offset,centralSize=central.reduce((sum,part)=>sum+part.length,0),end=[];
  push32(end,0x06054b50);push16(end,0);push16(end,0);push16(end,files.length);push16(end,files.length);push32(end,centralSize);push32(end,centralOffset);push16(end,0);
  return new Blob([...chunks,...central,new Uint8Array(end)],{type:XLSX_MIME});
}

function safeFilenamePart(value){
  return String(value||"").trim().replace(/[\\/:*?"<>|]+/g,"-").replace(/\s+/g,"-").replace(/^-+|-+$/g,"")||"weekly";
}

export function createTeacherWorkbookBlob(report){
  const pages=report.pages?.length?report.pages:[{warmup:[],strength:[],flexibility:[],cardio:{names:[],heartRates:[],minutes:[]}}];
  const sheetNames=pages.map((_,index)=>index===0?"Weekly Program":`Weekly Program ${index+1}`);
  const files=[
    {name:"[Content_Types].xml",data:contentTypesXml(pages.length)},
    {name:"_rels/.rels",data:rootRelsXml()},
    {name:"docProps/app.xml",data:appPropsXml(sheetNames)},
    {name:"docProps/core.xml",data:corePropsXml()},
    {name:"xl/workbook.xml",data:workbookXml(sheetNames)},
    {name:"xl/_rels/workbook.xml.rels",data:workbookRelsXml(pages.length)},
    {name:"xl/styles.xml",data:stylesXml()}
  ];
  pages.forEach((page,index)=>files.push({name:`xl/worksheets/sheet${index+1}.xml`,data:worksheetXml(report,page,index)}));
  return zipStore(files);
}

export function downloadTeacherWorkbook(report){
  const blob=createTeacherWorkbookBlob(report),anchor=document.createElement("a"),week=safeFilenamePart(report.weekStart||"weekly"),student=safeFilenamePart(report.student||"student");
  anchor.href=URL.createObjectURL(blob);
  anchor.download=`canada-workout-program-${student}-${week}.xlsx`;
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(anchor.href),1500);
  return {filename:anchor.download,size:blob.size};
}
