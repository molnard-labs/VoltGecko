interface Block { x:number; y:number; width:number; height:number }
export interface DiagramTile extends Block { column:number; row:number; columns:number; rows:number }

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
