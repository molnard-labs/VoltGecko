import { t, getLocale } from '../i18n';
import { buildBoardTopology, topologyEndpointKey } from '../data/boardTopology';
import type { BoardTopology, TopologyCircuitTerminal, TopologyDevice, TopologyDevicePole, TopologyNet, TopologySource } from '../data/boardTopology';
import { wiringEndpointLabel } from '../data/boardWiring';
import { circuitPhaseConnectionLabel } from './circuitPhaseLabels';
import { missingCircuitTerminals } from './missingCircuitTerminals';
import type { DiagramNetSegment } from './diagramPages';
import { drawSingleLineDeviceSymbol, drawSingleLineGroundSymbol, drawSingleLineLoadSymbol, getSingleLineDeviceRole, getSingleLinePoleLabel } from './singleLineSymbols';
import type { Board, CableDetails, Circuit, Conductor, Device, ProjectData, WiringEndpoint } from '../types';

export interface SingleLineDrawing {
  svg: string;
  width: number;
  height: number;
  blocks: { x:number; y:number; width:number; height:number }[];
  netSegments: DiagramNetSegment[];
}

const xml = (value:unknown):string => String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export const cableLabel = (cable?:CableDetails):string => cable ? [cable.material,cable.designation,cable.crossSectionMm2 !== undefined ? `${cable.cores ? `${cable.cores}×` : ''}${cable.crossSectionMm2} mm²` : '',cable.lengthM !== undefined ? `${cable.lengthM} m` : ''].filter(Boolean).join(' · ') : '';
export const circuitCableLabel = (circuit:Circuit):string => {
  const details=circuit.cableDetails;
  if(!details)return circuit.cable??'';
  return details.designation||details.crossSectionMm2!==undefined ? cableLabel(details) : [circuit.cable,cableLabel(details)].filter(Boolean).join(' · ');
};
function text(x:number,y:number,value:unknown,size=11,weight=400,anchor='start',fill='#161616'):string {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}">${xml(value)}</text>`;
}
function lines(value:string,max:number):string[] {
  const result:string[]=[];
  for (const paragraph of String(value || '').split('\n')) {
    let line='';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && (line.length + 1 + word.length > max)) {result.push(line); line='';}
      if (word.length > max) {
        if (line) {result.push(line);line='';}
        for (let i=0;i<word.length;i+=max) result.push(word.slice(i,i+max));
      } else line += (line ? ' ' : '') + word;
    }
    if (line) result.push(line);
  }
  return result.length ? result : ['—'];
}
function wrapped(x:number,y:number,value:string,max=22,size=11,weight=400,anchor='start',fill='#161616'):string {
  return lines(value,max).map((line,index)=>text(x,y+index*(size+3),line,size,weight,anchor,fill)).join('');
}
const phase = new Set<Conductor>(['L','L1','L2','L3']);
type Section = 'phase'|'neutral'|'earth'|'pen'|'unknown'|'mixed';
function sectionOf(net:TopologyNet):Section {
  const values = new Set(net.conductors);
  if(net.conflicted)return 'mixed';
  if (['L1','L2','L3'].filter(v=>values.has(v as Conductor)).length>1) return 'mixed';
  if (values.has('PEN') && ![...values].some(v=>phase.has(v))) return 'pen';
  const groups = [([...values].some(v=>phase.has(v)) ? 'phase' : ''),values.has('N')?'neutral':'',values.has('PE')?'earth':'',values.has('PEN')?'pen':''].filter(Boolean);
  return groups.length>1?'mixed':(groups[0] as Section | undefined) ?? 'unknown';
}
const sectionNames:Record<Section,string>={phase:'Fázisvezetők',neutral:'Nullavezető (N)',earth:'Védővezető (PE)',pen:'PEN vezető',unknown:'Nem azonosított vezető',mixed:'Eltérő vezetőfunkciók – ellenőrizendő'};
type DeviceEdge = { id:string; device:Device; boardId?:string; pole:TopologyDevicePole; a:string; b:string };
type Leaf = {kind:'circuit'; item:TopologyCircuitTerminal; circuit:Circuit} | {kind:'terminal'; device:Device; pole:TopologyDevicePole; side:'top'|'bottom'; openDevice:boolean; poleUnconfirmed:boolean; remote:boolean} | {kind:'reference'; edge:DeviceEdge; other:string; reference:string};
type Tree = {net:TopologyNet; incoming?:DeviceEdge; parent?:Tree; children:Tree[]; leaves:Leaf[]; depth:number; x:number; y:number; left:number; right:number};
type InlineSourceTerminal = {device:Device; pole:TopologyDevicePole; source:TopologySource; input:'top'|'bottom'};
type Forest = {section:Section; roots:Tree[]; width:number; height:number; startY:number; refs:DeviceEdge[]; inline:Map<string,InlineSourceTerminal>; omitted?:boolean};
const STEP_X=200, STEP_Y=170, MARGIN=42, LEFT=105;

/** Only place a terminal in series when every connection on its source side
 * is explicitly known. Any branch, ambiguity, or second source leaves the
 * terminal in the normal endpoint list instead of inventing a feed path. */
function inlineSourceTerminals(topology:BoardTopology,data:ProjectData,selectedBoardIds:Set<string>):Map<string,InlineSourceTerminal>{
  const result=new Map<string,InlineSourceTerminal>();
  const wiresAt=(key:string)=>topology.wires.filter(wire=>wire.fromKey===key||wire.toKey===key);
  const allWires=data.boards.flatMap(board=>board.wiring?.wires??[]);
  const allWireCount=(key:string)=>allWires.filter(wire=>topologyEndpointKey(wire.from)===key||topologyEndpointKey(wire.to)===key).length;
  const circuitsAt=(key:string)=>data.circuits.some(circuit=>circuit.boardConnections?.some(connection=>connection.terminals.some(terminal=>topologyEndpointKey(terminal.endpoint)===key)||connection.legacyTerminalConflicts?.some(conflict=>conflict.endpoints.some(endpoint=>topologyEndpointKey(endpoint)===key))));
  for(const item of topology.devices){
    if((item.boardId && !selectedBoardIds.has(item.boardId))||getSingleLineDeviceRole(item.device)!=='terminal'||item.poles.length!==1||item.device.electrical?.commonPoleGroups?.some(group=>new Set(group).size>1))continue;
    for(const pole of item.poles){
      if(pole.top.netId!==pole.bottom.netId)continue;
      const net=topology.nets.find(candidate=>candidate.id===pole.top.netId);
      if(!net||net.sources.length!==1||result.has(net.id))continue;
      const source=net.sources[0],sourceWires=wiresAt(source.terminalKey);
      if(sourceWires.length!==1||allWireCount(source.terminalKey)!==1||circuitsAt(source.terminalKey))continue;
      for(const input of ['top','bottom'] as const){
        const incoming=pole[input],outgoing=pole[input==='top'?'bottom':'top'];
        const inputWires=wiresAt(incoming.key),outputWires=wiresAt(outgoing.key),wire=sourceWires[0];
        if(inputWires.length!==1||outputWires.length!==1||allWireCount(incoming.key)!==1||allWireCount(outgoing.key)!==1||circuitsAt(incoming.key)||!wire.valid||wire.incompatible||!outputWires[0].valid||outputWires[0].incompatible)continue;
        if(outputWires[0].fromKey===outputWires[0].toKey)continue;
        if(!((wire.fromKey===source.terminalKey&&wire.toKey===incoming.key)||(wire.toKey===source.terminalKey&&wire.fromKey===incoming.key)))continue;
        result.set(net.id,{device:item.device,pole,source,input});break;
      }
    }
  }
  return result;
}

/** Only electrical nets and same-pole, known device paths participate in the tree.
 * A cycle is retained as a labelled continuation reference and in the detailed
 * connection table; it is never silently turned into a different connection. */
function makeForest(section:Section,nets:TopologyNet[],edges:DeviceEdge[],topology:BoardTopology,data:ProjectData,startY:number,selectedBoardIds:Set<string>):Forest {
  const map=new Map(nets.map(net=>[net.id,net]));
  const inline=new Map([...inlineSourceTerminals(topology,data,selectedBoardIds)].filter(([netId])=>map.has(netId)));
  const extraTop=inline.size?Math.max(100,80+Math.max(...[...inline.values()].map(item=>lines(sourceName(item.source,topology,data),29).length))*13):0;
  const adjacency=new Map(nets.map(net=>[net.id,[] as DeviceEdge[]]));
  for(const edge of edges) if(map.has(edge.a)&&map.has(edge.b)) {
    adjacency.get(edge.a)!.push(edge);
    if(edge.b!==edge.a) adjacency.get(edge.b)!.push(edge);
  }
  const connectionKey=(item:TopologyCircuitTerminal)=>JSON.stringify([item.circuitId,item.boardId,item.conductor,item.terminalKey]);
  const selectedConnections=new Set(topology.circuits.flatMap(item=>item.connections).map(connectionKey));
  const circuits=new Map(topology.circuits.map(item=>[item.circuit.id,item.circuit]));
  const terminalLeaves=new Map<string,Leaf[]>();
  const drawnEdges=new Set(edges.map(edge=>edge.id));
  // Devices without a known through-pole are not drawn as conducting switches.
  // Their explicit connected terminal is instead shown as an open endpoint.
  const relevantKeys=new Set(topology.wires.flatMap(wire=>[wire.fromKey,wire.toKey]));
  for(const item of topology.circuits) for(const connection of item.connections) relevantKeys.add(connection.terminalKey);
  for(const item of topology.devices) for(const pole of item.poles) {
    const series=inline.get(pole.top.netId);
    if(series?.device.id===item.device.id && series.pole.pole===pole.pole)continue;
    if(pole.through && pole.top.netId!==pole.bottom.netId && map.has(pole.top.netId) && map.has(pole.bottom.netId) && drawnEdges.has(JSON.stringify([item.device.id,pole.pole])))continue;
    for(const side of ['top','bottom'] as const) {
      const terminal=pole[side];
      if(!relevantKeys.has(terminal.key)||!map.has(terminal.netId)) continue;
      const list=terminalLeaves.get(terminal.netId)??[];
      if(!list.some(leaf=>leaf.kind==='terminal'&&leaf.device.id===item.device.id&&leaf.pole.pole===pole.pole&&pole.top.netId===pole.bottom.netId))
        list.push({kind:'terminal',device:item.device,pole,side,openDevice:pole.through && pole.top.netId!==pole.bottom.netId,poleUnconfirmed:item.poleDefinition!=='explicit' && item.poleDefinition!=='verified-product',remote:!!item.boardId&&!selectedBoardIds.has(item.boardId)});
      terminalLeaves.set(terminal.netId,list);
    }
  }
  const seen=new Set<string>(),edgeSeen=new Set<string>(),roots:Tree[]=[],refs:DeviceEdge[]=[],nodesByNet=new Map<string,Tree>();
  const ordered=[...nets].sort((a,b)=>Number(b.sources.length>0)-Number(a.sources.length>0)||a.id.localeCompare(b.id));
  for(const root of ordered) {
    if(seen.has(root.id))continue;
    const node:Tree={net:root,children:[],leaves:[],depth:0,x:0,y:0,left:0,right:0}; roots.push(node);seen.add(root.id);nodesByNet.set(root.id,node);
    const queue=[node];
    for(let i=0;i<queue.length;i++) {
      const current=queue[i];
      for(const item of current.net.circuits) {
        const circuit=circuits.get(item.circuitId);
        if(item.valid && selectedConnections.has(connectionKey(item))&&circuit)current.leaves.push({kind:'circuit',item,circuit});
      }
      current.leaves.push(...(terminalLeaves.get(current.net.id)??[]));
      for(const edge of adjacency.get(current.net.id)??[]) {
        if(edgeSeen.has(edge.id))continue;
        edgeSeen.add(edge.id);
        const other=edge.a===current.net.id?edge.b:edge.a;
        if(other===current.net.id||seen.has(other)) {
          refs.push(edge);
          const reference=`${t('Hurok')} ${section}-${refs.length}`;
          current.leaves.push({kind:'reference',edge,other,reference});
          const opposite=nodesByNet.get(other);
          if(opposite && opposite!==current)opposite.leaves.push({kind:'reference',edge,other:current.net.id,reference});
          continue;
        }
        const child:Tree={net:map.get(other)!,incoming:edge,parent:current,children:[],leaves:[],depth:current.depth+1,x:0,y:0,left:0,right:0};
        current.children.push(child);queue.push(child);seen.add(other);nodesByNet.set(other,child);
      }
    }
  }
  // Lay out independent trees in rows. Treating every disconnected root as a
  // single horizontal row can exceed the width limit even for a small board,
  // hiding every branch behind the large-network fallback.
  const columnsPerRow=Math.floor((3200-LEFT-MARGIN)/STEP_X);
  let rowColumns=0,rowOffset=0,rowDepth=0,maxColumns=0;
  for(const root of roots) {
    let column=0,rootDepth=0;
    const stack:[Tree,boolean][]=[[root,false]];
    while(stack.length){
      const [node,done]=stack.pop()!;rootDepth=Math.max(rootDepth,node.depth);
      if(!done){stack.push([node,true]);for(let i=node.children.length-1;i>=0;i--)stack.push([node.children[i],false]);continue;}
      const positions=node.children.map(child=>child.x);
      for(const leaf of node.leaves){(leaf as Leaf & {x?:number}).x=LEFT+(column++)*STEP_X;positions.push((leaf as Leaf & {x:number}).x);}
      if(!positions.length)positions.push(LEFT+(column++)*STEP_X);
      node.left=Math.min(...positions);node.right=Math.max(...positions);node.x=(node.left+node.right)/2;
    }
    const gap=rowColumns ? 1 : 0;
    if(rowColumns && rowColumns+gap+column>columnsPerRow){
      rowOffset+=rowDepth*STEP_Y+250;rowColumns=0;rowDepth=0;
    }
    const offset=(rowColumns ? rowColumns+1 : 0)*STEP_X;
    const queue=[root];
    for(let i=0;i<queue.length;i++){
      const node=queue[i];queue.push(...node.children);
      node.x+=offset;node.left+=offset;node.right+=offset;
      node.y=startY+90+extraTop+rowOffset+node.depth*STEP_Y;
      for(const leaf of node.leaves)(leaf as Leaf & {x:number}).x+=offset;
    }
    rowColumns=(rowColumns ? rowColumns+1 : 0)+column;
    rowDepth=Math.max(rowDepth,rootDepth);maxColumns=Math.max(maxColumns,rowColumns);
  }
  return {section,roots,width:Math.max(640,LEFT+Math.max(1,maxColumns)*STEP_X+MARGIN),height:Math.max(150,150+extraTop+rowOffset+(rowDepth+1)*STEP_Y),startY,refs,inline};
}

function sourceName(source:TopologySource,topology:BoardTopology,data:ProjectData):string {
  const item=topology.infeeds.find(item=>item.infeed.id===source.infeedId),infeed=item?.infeed ?? data.boards.find(board=>board.id===source.boardId)?.wiring?.infeeds.find(infeed=>infeed.id===source.infeedId);
  const device=data.devices.find(item=>item.id===source.deviceId);
  const owner=data.boards.find(board=>board.id===source.boardId);
  return [data.boards.length>1?owner?.name:'',infeed?.name ?? device?.code ?? t('Betáplálás'),`${source.pole+1} (${source.conductor})`,infeed?.currentA!==undefined?`${infeed.currentA} A`:'',cableLabel(infeed?.cable)].filter(Boolean).join(' · ');
}

function endpointLabel(data:ProjectData,endpoint:WiringEndpoint):string {
  const owner=data.boards.find(board=>endpoint.kind==='device'
    ? board.rows.some(row=>row.placements.some(item=>item.deviceId===endpoint.deviceId)) || data.devices.some(device=>device.id===endpoint.deviceId&&device.boardId===board.id)
    : endpoint.kind==='bus' ? board.wiring?.buses.some(bus=>bus.id===endpoint.busId)
      : board.wiring?.infeeds.some(source=>source.id===endpoint.infeedId));
  return [data.boards.length>1?owner?.name:'',wiringEndpointLabel(data,endpoint)].filter(Boolean).join(' · ');
}

function renderForest(forest:Forest,topology:BoardTopology,data:ProjectData,blocks:SingleLineDrawing['blocks'],netNames:Map<string,string>,netSegments:DiagramNetSegment[]):string {
  const pieces:string[]=[];
  if(forest.omitted)return text(MARGIN,forest.startY+26,t(sectionNames[forest.section]),15,700)+wrapped(MARGIN,forest.startY+49,t('A hálózat túl nagy vagy másik elosztón keresztül folytatódik; a pontos kapcsolatok a lenti jegyzékekben szerepelnek.'),90,11);
  const buses=new Map<string,string[]>();
  for(const item of topology.buses){const names=buses.get(item.netId)??[];names.push(`${item.bus.name} (${item.bus.conductor})`);buses.set(item.netId,names);}
  pieces.push(text(MARGIN,forest.startY+26,t(sectionNames[forest.section]),15,700));
  if(forest.section==='mixed')pieces.push(text(MARGIN,forest.startY+46,t('Eltérő vezetők egy hálózatra kerültek; ellenőrizd a bekötést.'),11,600,'start','#a12d24'));
  for(const root of forest.roots){
    const queue=[root];
    if(!root.net.sources.length&&!root.net.reachable)pieces.push(text(root.x,root.y-48,t('Betáplálás nem igazolt'),10,600,'middle','#a12d24'));
    for(let i=0;i<queue.length;i++){
      const node=queue[i];queue.push(...node.children);
      const positions=[node.x,...node.children.map(child=>child.x),...node.leaves.map(leaf=>(leaf as Leaf & {x:number}).x)];
      const left=Math.min(...positions),right=Math.max(...positions);
      if(right>left){pieces.push(`<path d="M${left} ${node.y}H${right}" fill="none" stroke="#151515" stroke-width="1.5" data-net-id="${xml(node.net.id)}"/>`);netSegments.push({x1:left,y1:node.y,x2:right,y2:node.y,net:netNames.get(node.net.id)??'?'});}
      else pieces.push(`<circle cx="${node.x}" cy="${node.y}" r="2.5" fill="#151515" data-net-id="${xml(node.net.id)}"/>`);
      const series=forest.inline.get(node.net.id);
      const netLabel=[netNames.get(node.net.id),...(buses.get(node.net.id)??[]),...(series?[]:node.net.sources.map(source=>sourceName(source,topology,data)))].filter(Boolean).join(' · ');
      const labelX=series?node.x+14:node.x,labelAnchor=series?'start':'middle';
      if(netLabel)pieces.push(wrapped(labelX,node.y-16-(lines(netLabel,29).length-1)*13,netLabel,29,10,600,labelAnchor,forest.section==='mixed'||node.net.conflicted?'#a12d24':'#161616'));
      if(netLabel)blocks.push({x:series?labelX:node.x-90,y:node.y-27-(lines(netLabel,29).length-1)*13,width:180,height:lines(netLabel,29).length*13});
      if(series){
        const symbolY=node.y-96,symbolHeight=44,terminal=series.pole[series.input],other=series.pole[series.input==='top'?'bottom':'top'];
        const sourceLabel=sourceName(series.source,topology,data),sourceLines=lines(sourceLabel,29);
        sourceLines.forEach((line,index)=>pieces.push(text(node.x,symbolY-20-(sourceLines.length-1-index)*13,line,10,600,'middle')));
        pieces.push(`<path d="M${node.x} ${symbolY-10}V${symbolY}" fill="none" stroke="#151515" stroke-width="1.4"/>`);
        pieces.push(`<g data-device-id="${xml(series.device.id)}" data-pole="${series.pole.pole}" data-conductor="${xml(series.pole.conductor)}" data-source-terminal="true" tabindex="0" role="button" aria-label="${xml(`${series.device.code} · ${series.device.name}`)}"><title>${xml(`${sourceLabel}\n${endpointLabel(data,terminal.endpoint)} ↔ ${endpointLabel(data,other.endpoint)}`)}</title>${drawSingleLineDeviceSymbol(series.device,{x:node.x,y:symbolY,height:symbolHeight})}</g>`);
        pieces.push(`<path d="M${node.x} ${symbolY+symbolHeight}V${node.y}" fill="none" stroke="#151515" stroke-width="1.4"/>`);
        netSegments.push({x1:node.x,y1:symbolY-10,x2:node.x,y2:symbolY,net:netNames.get(node.net.id)??'?'},{x1:node.x,y1:symbolY+symbolHeight,x2:node.x,y2:node.y,net:netNames.get(node.net.id)??'?'});
        pieces.push(text(node.x+14,symbolY+14,series.device.code,11,700));
        pieces.push(wrapped(node.x+14,symbolY+28,`${wiringEndpointLabel(data,terminal.endpoint)} ↔ ${wiringEndpointLabel(data,other.endpoint)}`,23,9));
        blocks.push({x:node.x-14,y:symbolY-10,width:185,height:80},{x:node.x-90,y:symbolY-34-(sourceLines.length-1)*13,width:180,height:sourceLines.length*13});
      }
      if(node.net.sources.length>1)pieces.push(text(node.x,node.y-32,t('Több forrás – ellenőrizendő'),10,600,'middle','#a12d24'));
      if(topology.wires.some(wire=>wire.incompatible&&(wire.fromNetId===node.net.id||wire.toNetId===node.net.id)))pieces.push(text(node.x,node.y+14,t('Hibás vezetőkapcsolat – lásd a jegyzéket'),9,600,'middle','#a12d24'));
      const branches=[...new Set(positions)];
      if(right>left)for(const x of branches)pieces.push(`<circle cx="${x}" cy="${node.y}" r="2.5" fill="#151515"/>`);
      for(const child of node.children){
        const edge=child.incoming!,p=edge.pole;
        const sourceIsTop=p.top.netId===node.net.id;
        const a=sourceIsTop?p.top.endpoint:p.bottom.endpoint,b=sourceIsTop?p.bottom.endpoint:p.top.endpoint;
        const owner=data.boards.find(item=>item.id===edge.boardId);
        const symbolY=node.y+28,symbolHeight=52;
        pieces.push(`<path d="M${child.x} ${node.y}V${symbolY}" fill="none" stroke="#151515" stroke-width="1.4"/>`);
        netSegments.push({x1:child.x,y1:node.y,x2:child.x,y2:symbolY,net:netNames.get(node.net.id)??'?'});
        pieces.push(`<g data-device-id="${xml(edge.device.id)}" data-pole="${p.pole}" data-conductor="${xml(p.conductor)}" tabindex="0" role="button" aria-label="${xml(`${edge.device.code} · ${edge.device.name}`)}"><title>${xml(`${edge.device.code} · ${edge.device.name}\n${endpointLabel(data,a)} ↔ ${endpointLabel(data,b)}`)}</title>${drawSingleLineDeviceSymbol(edge.device,{x:child.x,y:symbolY,height:symbolHeight})}</g>`);
        pieces.push(`<path d="M${child.x} ${symbolY+symbolHeight}V${child.y}" fill="none" stroke="#151515" stroke-width="1.4"/>`);
        netSegments.push({x1:child.x,y1:symbolY+symbolHeight,x2:child.x,y2:child.y,net:netNames.get(child.net.id)??'?'});
        pieces.push(text(child.x+13,symbolY+12,[data.boards.length>1?owner?.name:'',edge.device.code].filter(Boolean).join(' · '),12,700));
        const e=edge.device.electrical;
        const rating=[e?.curve&&e.currentA!==undefined?`${e.curve}${e.currentA} A`:e?.currentA!==undefined?`${e.currentA} A`:'',e?.residualCurrentMa!==undefined?`${e.residualCurrentMa} mA`:'',e?.residualType?`Type ${e.residualType}`:'',e?.spdClass].filter(Boolean).join(' · ');
        const shortLines=(value:string,max:number,count:number)=>{
          const result=lines(value,max);
          return result.length>count?[...result.slice(0,count-1),`${result[count-1].slice(0,max-1)}…`]:result;
        };
        shortLines(rating||edge.device.rating||edge.device.name,21,2).forEach((line,index)=>pieces.push(text(child.x+13,symbolY+27+index*13,line,10)));
        const terminalLines=shortLines(`${wiringEndpointLabel(data,a)} ↔ ${wiringEndpointLabel(data,b)}`,23,3);
        terminalLines.forEach((line,index)=>pieces.push(text(child.x+13,symbolY+62+index*12,line,9)));
        const poles=getSingleLinePoleLabel(edge.device);if(poles)pieces.push(text(child.x+13,symbolY+62+terminalLines.length*12,poles,9));
        blocks.push({x:child.x-14,y:symbolY-5,width:175,height:120});
      }
      for(const leaf of node.leaves){
        const x=(leaf as Leaf & {x:number}).x;
        pieces.push(`<path d="M${x} ${node.y}V${node.y+34}" fill="none" stroke="#151515" stroke-width="1.3"/>`);
        netSegments.push({x1:x,y1:node.y,x2:x,y2:node.y+34,net:netNames.get(node.net.id)??'?'});
        if(leaf.kind==='circuit'){
          const {item,circuit}=leaf;
          const title=`${circuit.code} · ${item.conductor} ↔ ${endpointLabel(data,item.endpoint)}\n${circuit.name}\n${circuitCableLabel(circuit)}`;
          pieces.push(`<g data-circuit-id="${xml(circuit.id)}" data-circuit-port="${xml(item.conductor)}" data-board-id="${xml(item.boardId)}"><title>${xml(title)}</title>`);
          if(forest.section==='phase')pieces.push(drawSingleLineLoadSymbol(circuit.loadType,x,node.y+34));
          else pieces.push(`<circle cx="${x}" cy="${node.y+39}" r="4" fill="#fff" stroke="#151515"/>`);
          const nameLines=lines(`${circuit.code} · ${circuit.name}`,20);
          const shownName=nameLines.length>3?[...nameLines.slice(0,2),`${nameLines[2].slice(0,19)}…`]:nameLines;
          shownName.forEach((line,index)=>pieces.push(text(x+14,node.y+48+index*14,line,11,700)));
          const cableLines=lines(circuitCableLabel(circuit),23);
          const shownCable=cableLines.length>2?[cableLines[0],`${cableLines[1].slice(0,22)}…`]:cableLines;
          shownCable.forEach((line,index)=>pieces.push(text(x+14,node.y+48+shownName.length*14+index*13,line,10)));
          pieces.push('</g>');
          blocks.push({x:x-15,y:node.y+25,width:190,height:32+shownName.length*14+shownCable.length*13});
        }else if(leaf.kind==='terminal'){
          const {device,pole,side}=leaf;
          const label=endpointLabel(data,pole[side].endpoint);
          pieces.push(`<g data-device-id="${xml(device.id)}" tabindex="0" role="button" aria-label="${xml(`${device.code} · ${device.name}`)}"><title>${xml(label)}</title>`);
          if(leaf.remote) {
            pieces.push(`<circle cx="${x}" cy="${node.y+38}" r="4" fill="#fff" stroke="#151515"/>${wrapped(x+12,node.y+43,label,22,10,600)}`);
            pieces.push(wrapped(x+12,node.y+57,t('Távoli elosztó – folytatás az összes elosztó nézetben.'),24,9,600));
          } else if(leaf.openDevice) {
            pieces.push(drawSingleLineDeviceSymbol(device,{x,y:node.y+34,height:42}));
            pieces.push(`<circle cx="${x}" cy="${node.y+76}" r="4" fill="#fff" stroke="#151515"/>`);
            pieces.push(wrapped(x+12,node.y+48,label,22,10,600));
            pieces.push(text(x+12,node.y+76,t('Szabad, bekötetlen vég'),9,600,'start','#a12d24'));
          } else if(getSingleLineDeviceRole(device)==='terminal' && pole.top.netId===pole.bottom.netId) {
            pieces.push(`<circle cx="${x}" cy="${node.y+38}" r="4" fill="#fff" stroke="#151515"/>`);
            pieces.push(wrapped(x+12,node.y+48,label,22,10,600));
          } else {
            pieces.push(`<circle cx="${x}" cy="${node.y+38}" r="4" fill="#fff" stroke="#151515"/>${text(x+12,node.y+43,label,10,600)}`);
            if(leaf.poleUnconfirmed)pieces.push(wrapped(x+12,node.y+57,t('Pólusadat nincs megerősítve – állítsd be a készüléknél.'),24,9,600,'start','#a12d24'));
            else if(!pole.through)pieces.push(text(x+12,node.y+57,t('A belső kapcsolat nem ismert'),9,400,'start','#a12d24'));
          }
          pieces.push('</g>');blocks.push({x:x-12,y:node.y+28,width:175,height:62});
        }else{
          pieces.push(`<circle cx="${x}" cy="${node.y+38}" r="4" fill="#fff" stroke="#151515"/>`);
          pieces.push(wrapped(x+12,node.y+43,`${leaf.reference} · ${endpointLabel(data,leaf.edge.pole.top.endpoint)} ↔ ${endpointLabel(data,leaf.edge.pole.bottom.endpoint)} → ${netNames.get(leaf.other)??'?'}`,22,10,600));
        }
      }
      if(forest.section==='earth' && node.net.sources.some(source=>source.kind==='earth')) {
        const gx=node.right+35;
        pieces.push(`<path d="M${node.right} ${node.y}H${gx}V${node.y+18}" fill="none" stroke="#151515" stroke-width="1.4"/>${drawSingleLineGroundSymbol(gx,node.y+18)}`);
      }
    }
  }
  return pieces.join('');
}

/** Pure SVG shared by the application, SVG/PNG export and the PDF. */
export function buildSingleLineSvg(data:ProjectData,board:Board,combined=false):SingleLineDrawing {
  const boards=combined?data.boards:[board],topology=buildBoardTopology(data,boards);
  const relevant=new Set<string>();
  for(const bus of topology.buses)relevant.add(bus.netId);
  for(const source of topology.infeeds)for(const pole of source.poles)relevant.add(pole.netId);
  for(const wire of topology.wires){relevant.add(wire.fromNetId);relevant.add(wire.toNetId);}
  for(const circuit of topology.circuits)for(const item of circuit.connections)relevant.add(item.netId);
  // A globally connected net can cross a remote board and return. In a local
  // board view, do not turn that remote route into a fictitious local bus.
  // Include the concrete remote wires in the schedule and use the explicit
  // net/terminal schedule instead of a condensed rail for affected sections.
  const fullTopology=!combined&&data.boards.length>1?buildBoardTopology(data,data.boards):topology;
  const wireKey=(item:{boardId:string;wire:{id:string}})=>JSON.stringify([item.boardId,item.wire.id]);
  const displayedWireKeys=new Set(topology.wires.map(wireKey));
  const remoteWires=fullTopology.wires.filter(item=>!displayedWireKeys.has(wireKey(item))&&(relevant.has(item.fromNetId)||relevant.has(item.toNetId)));
  const remoteNets=new Set(remoteWires.flatMap(item=>[item.fromNetId,item.toNetId]));
  const nets=topology.nets.filter(net=>relevant.has(net.id));
  const netNames=new Map([...nets].sort((a,b)=>a.id.localeCompare(b.id)).map((net,index)=>[net.id,`H${index+1}`]));
  const boardIds=new Set(boards.map(item=>item.id));
  const edges:DeviceEdge[]=topology.devices.flatMap(({device,boardId,poles}:TopologyDevice)=>poles.filter(pole=>(!boardId||boardIds.has(boardId)) && pole.through && relevant.has(pole.top.netId) && relevant.has(pole.bottom.netId) && (pole.top.netId!==pole.bottom.netId || device.electrical?.role!=='terminal')).map(pole=>({id:JSON.stringify([device.id,pole.pole]),device,boardId,pole,a:pole.top.netId,b:pole.bottom.netId})));
  const sections:Section[]=['phase','neutral','earth','pen','mixed','unknown'];
  let y=125,width=800,overview='';
  const overviewBlocks:SingleLineDrawing['blocks']=[];
  const missing=missingCircuitTerminals(topology.circuits,boardIds);
  if(missing.length){
    overview+=text(MARGIN,y+5,t('Hiányzó áramköri végpontok'),13,700,'start','#a12d24');y+=24;
    for(const entry of missing){
      const label=entry.conductor==='L'?'{circuits}: fáziskapocs nincs megadva az elosztóterven.'
        :entry.conductor==='N'?'{circuits}: N-kapocs nincs megadva az elosztóterven.'
          :'{circuits}: PE-kapocs nincs megadva az elosztóterven.';
      const owner=combined?data.boards.find(item=>item.id===entry.boardId)?.name:'';
      const message=[owner,t(label,{circuits:entry.circuits.join(', ')})].filter(Boolean).join(' · ');
      const count=lines(message,95).length;
      overview+=wrapped(MARGIN,y,message,95,11,400,'start','#a12d24');
      overviewBlocks.push({x:MARGIN,y:y-12,width:716,height:count*14});
      y+=count*14+4;
    }
    y+=20;
  }
  const forests:Forest[]=[];
  for(const section of sections){
    const group=nets.filter(net=>sectionOf(net)===section);
    if(!group.length)continue;
    const forest=makeForest(section,group,edges,topology,data,y,boardIds);
    if(forest.width>3200||forest.height>40000||group.some(net=>remoteNets.has(net.id))){forest.omitted=true;forest.width=800;forest.height=100;}
    forests.push(forest);width=Math.max(width,forest.width);y+=forest.height;
  }
  const blocks:SingleLineDrawing['blocks']=[...overviewBlocks],netSegments:DiagramNetSegment[]=[];
  let content=overview+forests.map(forest=>renderForest(forest,topology,data,blocks,netNames,netSegments)).join('');
  if(!nets.length) {content+=text(MARGIN,y+30,t(topology.devices.length?'Nincs megadott kapcsolat':'Nincs készülék az elosztóban'),15,600); y+=80;}
  // The complete connection table is an exact record of physical wires and
  // circuit terminals, including loops and multiple parallel wires. It never
  // invents a source direction or merges unconnected conductor nets.
  const records:{id:string;kind:string;from:string;to:string;detail:string;error:boolean}[]=[];
  for(const item of [...topology.wires,...remoteWires]){
    const {wire}=item;
    const owner=data.boards.find(board=>board.id===item.boardId);
    records.push({id:wire.id,kind:[t('Vezeték'),data.boards.length>1?owner?.name:''].filter(Boolean).join(' · '),from:endpointLabel(data,wire.from),to:endpointLabel(data,wire.to),detail:[cableLabel(wire.cable),wire.label].filter(Boolean).join(' · '),error:!item.valid||item.incompatible});
  }
  for(const item of topology.circuits)for(const connection of item.connections)records.push({
    id:`circuit:${item.circuit.id}:${connection.boardId}:${connection.conductor}`,kind:t('Áramkör'),from:`${item.circuit.code} · ${connection.conductor}`,to:endpointLabel(data,connection.endpoint),detail:circuitCableLabel(item.circuit),error:!connection.valid
  });
  for(const legacy of topology.legacy){
    const from=legacy.connection.fromDeviceId ? data.devices.find(item=>item.id===legacy.connection.fromDeviceId)?.code ?? legacy.connection.fromDeviceId : boards.find(item=>item.id===legacy.boardId)?.supplyLabel || t('Betáplálás');
    const to=data.devices.find(item=>item.id===legacy.connection.toDeviceId)?.code ?? legacy.connection.toDeviceId;
    records.push({id:legacy.connection.id,kind:t('Részletezetlen kapcsolat'),from,to,detail:t('A pontos kapcsok nincsenek megadva.'),error:true});
  }
  for(const item of topology.circuits)for(const conflict of item.unresolved)records.push({id:`unresolved:${item.circuit.id}:${conflict.boardId}:${conflict.conductor}`,kind:t('Tisztázandó'),from:`${item.circuit.code} · ${conflict.conductor}`,to:conflict.endpoints.map(endpoint=>endpointLabel(data,endpoint)).join(' / '),detail:t('Korábbi fázisbekötés tisztázandó az elosztón.'),error:true});
  for(const forest of forests)for(const [index,edge] of forest.refs.entries())records.push({id:`pole:${edge.id}`,kind:`${t('Hurok')} ${forest.section}-${index+1}`,from:endpointLabel(data,edge.pole.top.endpoint),to:endpointLabel(data,edge.pole.bottom.endpoint),detail:`${netNames.get(edge.a)??'?'} ↔ ${netNames.get(edge.b)??'?'}`,error:false});
  for(const item of topology.devices.filter(device=>device.poleDefinition!=='explicit' && device.poleDefinition!=='verified-product'))for(const pole of item.poles)if(relevant.has(pole.top.netId)||relevant.has(pole.bottom.netId))records.push({id:`uncertain-pole:${item.device.id}:${pole.pole}`,kind:t('Pólusadat tisztázandó'),from:endpointLabel(data,pole.top.endpoint),to:endpointLabel(data,pole.bottom.endpoint),detail:t('Pólusadat nincs megerősítve – állítsd be a készüléknél.'),error:true});
  const tableWidth=Math.max(716,width-MARGIN*2), cols=[120,210,210,tableWidth-540];
  const colx=[MARGIN,MARGIN+cols[0],MARGIN+cols[0]+cols[1],MARGIN+cols[0]+cols[1]+cols[2]];
  y+=24;content+=text(MARGIN,y,t('Elosztói kapcsolatok'),15,700);y+=14;
  const row=(values:string[],id?:string,error=false,device?:Device)=>{
    const wrappedValues=values.map((value,index)=>lines(value,Math.max(10,Math.floor((cols[index]-12)/6))));
    const h=Math.max(28,Math.max(...wrappedValues.map(value=>value.length))*14+12);
    const title=values.join(' · ');
    let s=`<g${id?` data-connection-id="${xml(id)}"`:''}${device?` data-device-id="${xml(device.id)}" tabindex="0" role="button" aria-label="${xml(`${device.code} · ${device.name}`)}"`:''}><title>${xml(title)}</title><rect x="${MARGIN}" y="${y}" width="${tableWidth}" height="${h}" fill="${error?'#fff8f5':'#fff'}" stroke="#777" stroke-width="0.7"/>`;
    for(let col=1;col<4;col++)s+=`<path d="M${colx[col]} ${y}V${y+h}" stroke="#999" stroke-width="0.7"/>`;
    if(id?.startsWith('uncertain-pole:'))s+=`<path d="M${colx[2]-25} ${y+h-7}h18" stroke="#a12d24" stroke-width="1.5" stroke-dasharray="3 3"/>`;
    wrappedValues.forEach((value,col)=>value.forEach((line,index)=>{s+=text(colx[col]+6,y+18+index*14,line,10,400,'start',error?'#932a23':'#161616');}));
    s+='</g>';for(let col=0;col<4;col++)blocks.push({x:colx[col],y,width:cols[col],height:h});y+=h;return s;
  };
  content+=row([t('Típus'),t('Egyik végpont'),t('Másik végpont'),t('Adatok')]);
  for(const record of records)content+=row([record.kind,record.from,record.to,record.detail],record.id,record.error);
  if(forests.some(forest=>forest.omitted)){
    y+=28;content+=text(MARGIN,y,t('Hálózatok és készülékpólusok'),15,700);y+=14;
    content+=row([t('Hálózat'),t('Kapcsok'),t('Vezető'),t('Adatok')]);
    for(const net of nets)content+=row([netNames.get(net.id)??'',net.terminals.map(terminal=>endpointLabel(data,terminal.endpoint)).join(' · '),net.conductors.join(' / '),net.sources.map(source=>sourceName(source,topology,data)).join(' · ')]);
    for(const edge of edges)content+=row([t('Készülékpólus'),endpointLabel(data,edge.pole.top.endpoint),endpointLabel(data,edge.pole.bottom.endpoint),`${netNames.get(edge.a)??'?'} ↔ ${netNames.get(edge.b)??'?'}`]);
  }
  y+=28;content+=text(MARGIN,y,t('Áramkörjegyzék'),15,700);y+=14;
  content+=row([t('Áramkör'),t('Megnevezés'),t('Fázisbekötés'),t('Kábel / vezeték')]);
  for(const item of topology.circuits)content+=row([item.circuit.code,item.circuit.name,circuitPhaseConnectionLabel(data,item.circuit,combined?undefined:board.id),[circuitCableLabel(item.circuit),item.circuit.powerW!==undefined?`${item.circuit.powerW.toLocaleString(getLocale())} W`:''].filter(Boolean).join(' · ')]);
  const visibleDevices=new Set<string>();
  for(const forest of forests)if(!forest.omitted)for(const series of forest.inline.values())visibleDevices.add(series.device.id);
  for(const forest of forests)if(!forest.omitted)for(const root of forest.roots){
    const queue=[root];
    for(let i=0;i<queue.length;i++){
      const node=queue[i];queue.push(...node.children);
      for(const child of node.children)if(child.incoming)visibleDevices.add(child.incoming.device.id);
      for(const leaf of node.leaves)if(leaf.kind==='terminal')visibleDevices.add(leaf.device.id);
    }
  }
  if(topology.devices.length){
    y+=28;content+=text(MARGIN,y,t('Készülékjegyzék'),15,700);y+=14;
    content+=row([t('Készülék'),t('Megnevezés'),t('Villamos adatok'),t('Állapot / megjegyzés')]);
    for(const item of topology.devices){
      const d=item.device,e=d.electrical;
      const electrical=[e?.curve&&e.currentA!==undefined?`${e.curve}${e.currentA} A`:e?.currentA!==undefined?`${e.currentA} A`:'',e?.residualCurrentMa!==undefined?`${e.residualCurrentMa} mA`:'',e?.residualType?`Type ${e.residualType}`:'',e?.spdClass,e?.poles?.length?e.poles.join(' / '):''].filter(Boolean).join(' · ');
      const rating=[electrical?`${t('Beállított villamos adatok')}: ${electrical}`:'',d.rating?`${t('Szöveges névleges adat')}: ${d.rating}`:''].filter(Boolean).join('\n');
      const connected=item.poles.some(pole=>relevant.has(pole.top.netId)||relevant.has(pole.bottom.netId));
      const note=[!connected?t('Nincs bekötve'):'',item.poleDefinition!=='explicit' && item.poleDefinition!=='verified-product'?t('Pólusadat nincs megerősítve – állítsd be a készüléknél.'):'',item.sourceSideUnspecified?t('Betáplálás iránya nincs megadva'): ''].filter(Boolean).join(' · ');
      content+=row([d.code,[d.name,d.model,d.product?.reference].filter(Boolean).join(' · '),rating,note],undefined,Boolean(note),visibleDevices.has(d.id)?undefined:d);
    }
  }
  if(topology.issues.length){y+=25;content+=text(MARGIN,y,t('Kapcsolati jelzések'),14,700,'start','#a12d24');y+=16;for(const issue of topology.issues){const ls=lines(issue.message,Math.floor(tableWidth/6));content+=wrapped(MARGIN,y,issue.message,Math.floor(tableWidth/6),10,400,'start','#a12d24');y+=ls.length*14+5;}}
  y+=25;const footerY=y;content+=`<rect x="${MARGIN}" y="${y}" width="${tableWidth}" height="52" fill="none" stroke="#222"/>`;
  content+=text(MARGIN+8,y+20,data.name,12,700)+text(MARGIN+8,y+39,board.name,10)+text(width-MARGIN-8,y+39,t('Egyvonalas rajz'),10,600,'end');
  blocks.push({x:MARGIN,y:footerY,width:tableWidth/2,height:52},{x:MARGIN+tableWidth/2,y:footerY,width:tableWidth/2,height:52});
  y+=82;
  const height=Math.ceil(y);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${height}" viewBox="0 0 ${Math.ceil(width)} ${height}" role="img" aria-labelledby="single-line-title single-line-description"><title id="single-line-title">${xml(`${board.name} · ${t('Egyvonalas rajz')}`)}</title><desc id="single-line-description">${xml(t('Az elosztóban megadott vezetékek és korábbi, részletezetlen kapcsolatok.'))}</desc><rect width="${Math.ceil(width)}" height="${height}" fill="#fff"/><rect x="12" y="12" width="${Math.ceil(width)-24}" height="${height-24}" fill="none" stroke="#222" stroke-width="1.2"/><g font-family="Arial, Helvetica, sans-serif">${text(MARGIN,46,t('Egyvonalas kapcsolási rajz'),21,700)}${text(MARGIN,70,board.name,13,600)}${text(MARGIN,92,t('A rajz a megadott kapcsolatokat mutatja; a kapcsolók állapota nem ismert.'),10)}${content}</g></svg>`;
  return {svg,width:Math.ceil(width),height,blocks,netSegments};
}

export function buildProjectSingleLineSvg(data:ProjectData):SingleLineDrawing {
  const board:Board={id:'combined-project-view',name:data.name,rows:[],connections:[],wiring:{buses:[],infeeds:[],wires:[]}};
  return buildSingleLineSvg(data,board,true);
}
