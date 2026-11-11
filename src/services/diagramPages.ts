import type { Board, Device, CircuitBoardConnection } from '../types';
interface Block { x:number; y:number; width:number; height:number }
export interface DiagramTile extends Block { column:number; row:number; columns:number; rows:number }
export interface DiagramNetSegment { x1:number; y1:number; x2:number; y2:number; net:string }
export interface DiagramContinuation { x:number; y:number; net:string; column:number; row:number; side:'left'|'right'|'top'|'bottom' }

/** Label both sides of a page cut with the same actual net and adjacent tile. */
export function diagramContinuations(tile:DiagramTile,segments:DiagramNetSegment[]):DiagramContinuation[] {
  const result:DiagramContinuation[]=[];
  for(const s of segments){
    if(s.y1===s.y2 && s.y1>=tile.y && s.y1<=tile.y+tile.height){
      const min=Math.min(s.x1,s.x2),max=Math.max(s.x1,s.x2);
      if(tile.column>1 && min<tile.x && max>tile.x)result.push({x:tile.x,y:s.y1,net:s.net,column:tile.column-1,row:tile.row,side:'left'});
      const right=tile.x+tile.width;
      if(tile.column<tile.columns && min<right && max>right)result.push({x:right,y:s.y1,net:s.net,column:tile.column+1,row:tile.row,side:'right'});
    }
    if(s.x1===s.x2 && s.x1>=tile.x && s.x1<=tile.x+tile.width){
      const min=Math.min(s.y1,s.y2),max=Math.max(s.y1,s.y2);
      if(tile.row>1 && min<tile.y && max>tile.y)result.push({x:s.x1,y:tile.y,net:s.net,column:tile.column,row:tile.row-1,side:'top'});
      const bottom=tile.y+tile.height;
      if(tile.row<tile.rows && min<bottom && max>bottom)result.push({x:s.x1,y:bottom,net:s.net,column:tile.column,row:tile.row+1,side:'bottom'});
    }
  }
  return result.filter((item,index)=>result.findIndex(other=>other.x===item.x&&other.y===item.y&&other.net===item.net&&other.side===item.side)===index);
}

/** A partially designed cabinet still has meaningful, potentially unconnected equipment. */
export function hasBoardDiagramContent(board:Board,devices:Device[],connections:CircuitBoardConnection[]):boolean {
  return Boolean(board.connections?.length || board.wiring?.wires.length || board.wiring?.buses.length || board.wiring?.infeeds.length ||
    board.rows.some(row=>row.placements.length) || devices.some(device=>device.boardId===board.id) ||
    connections.some(connection=>connection.terminals.length || connection.legacyTerminalConflicts?.length));
}

/** Continuous coverage; page boundaries move into whitespace around normal-sized cards. */
export function diagramTiles(drawing:{width:number;height:number;blocks:Block[]},maxWidth:number,maxHeight:number):DiagramTile[]{
  const segments=(extent:number,limit:number,blocks:{start:number;end:number}[])=>{
    if(!Number.isFinite(extent)||!Number.isFinite(limit)||extent<=0||limit<=0)throw new Error('Invalid diagram dimensions');
    const spans:{start:number;length:number}[]=[];
    let start=0;
    while(start<extent-1e-7){
      let end=Math.min(start+limit,extent);
      // Moving a cut before one block can place it inside the preceding row.
      // Recheck until the cut is clear, while guaranteeing forward progress
      // for oversized or densely overlapping elements.
      while (true) {
        const crossing=blocks.filter(block=>block.start<end&&block.end>end);
        if (!crossing.length) break;
        const boundary=Math.min(...crossing.map(block=>block.start));
        const padded=boundary-12;
        // Adjacent rows share a border. A padded cut would bisect the prior
        // row, so use the shared border when there is no whitespace.
        const before=padded>start+24 && !blocks.some(block=>block.start<padded&&block.end>padded) ? padded : boundary;
        if (before<=start+24 || before>=end) break;
        end=before;
      }
      spans.push({start,length:end-start});start=end;
      if(spans.length>200)throw new Error('Too many diagram pages');
    }
    return spans;
  };
  const xs=segments(drawing.width,maxWidth,drawing.blocks.map(block=>({start:block.x,end:block.x+block.width})));
  const ys=segments(drawing.height,maxHeight,drawing.blocks.map(block=>({start:block.y,end:block.y+block.height})));
  if(xs.length*ys.length>200)throw new Error('Too many diagram pages');
  return ys.flatMap((y,row)=>xs.map((x,column)=>({x:x.start,y:y.start,width:x.length,height:y.length,column:column+1,row:row+1,columns:xs.length,rows:ys.length})));
}
