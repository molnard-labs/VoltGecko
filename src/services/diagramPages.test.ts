import { describe, expect, it } from 'vitest';
import { diagramContinuations, diagramTiles, hasBoardDiagramContent } from './diagramPages';
import type { Board, Device } from '../types';
describe('readable PDF diagram pagination',()=>{
  it('includes a partially designed board with only devices, buses or sources',()=>{
    const empty:Board={id:'a',name:'A',rows:[],wiring:{wires:[],buses:[],infeeds:[]}};
    expect(hasBoardDiagramContent(empty,[],[])).toBe(false);
    const positioned:Board={...empty,rows:[{id:'row',name:'row',capacity:12,placements:[{deviceId:'d',start:0}]}]};
    expect(hasBoardDiagramContent(positioned,[],[])).toBe(true);
    expect(hasBoardDiagramContent(empty,[{boardId:'a'} as Device],[])).toBe(true);
    expect(hasBoardDiagramContent({...empty,wiring:{wires:[],buses:[{id:'b',name:'N',conductor:'N',capacity:2,terminalLabels:[],position:'top'}],infeeds:[]}},[],[])).toBe(true);
    expect(hasBoardDiagramContent({...empty,wiring:{wires:[],buses:[],infeeds:[{id:'s',name:'input',kind:'supply',poles:['L']}]}},[],[])).toBe(true);
    expect(hasBoardDiagramContent(empty,[],[{boardId:'a',terminals:[],legacyTerminalConflicts:[{conductor:'L',endpoints:[]}]}])).toBe(true);
  });
  it('keeps normal device cards whole across both page axes and preserves complete drawing coverage',()=>{
    const blocks=Array.from({length:12},(_,index)=>({x:48+(index%6)*324,y:170+Math.floor(index/6)*500,width:264,height:236}));
    const tiles=diagramTiles({width:2050,height:1300,blocks},1476,807);
    for(const block of blocks)expect(tiles.some(tile=>tile.x<=block.x&&tile.x+tile.width>=block.x+block.width&&tile.y<=block.y&&tile.y+tile.height>=block.y+block.height)).toBe(true);
    expect(tiles[0].x).toBe(0);expect(tiles[0].y).toBe(0);
    const row=tiles.filter(tile=>tile.row===1);
    row.forEach((tile,index)=>{if(index>0)expect(tile.x).toBeCloseTo(row[index-1].x+row[index-1].width);});
    expect(row.at(-1)!.x+row.at(-1)!.width).toBe(2050);
    const column=tiles.filter(tile=>tile.column===1);
    column.forEach((tile,index)=>{if(index>0)expect(tile.y).toBeCloseTo(column[index-1].y+column[index-1].height);});
    expect(column.at(-1)!.y+column.at(-1)!.height).toBe(1300);
  });
  it('exports all portions of a card taller than a page without looping or skipping its data',()=>{
    const tiles=diagramTiles({width:640,height:4000,blocks:[{x:48,y:100,width:264,height:3500}]},1476,807);
    expect(tiles.length).toBeGreaterThan(4);
    expect(tiles.reduce((sum,tile)=>sum+tile.height,0)).toBe(4000);
    expect(tiles.every(tile=>tile.height>0&&tile.height<=807)).toBe(true);
  });
  it('bounds resource use for impossible dimensions and very large documents',()=>{
    expect(()=>diagramTiles({width:0,height:100,blocks:[]},100,100)).toThrow();
    expect(()=>diagramTiles({width:100,height:1e9,blocks:[]},100,100)).toThrow('Too many');
  });
  it('pairs exact network and adjacent tile references on both sides of each cut',()=>{
    const tiles=diagramTiles({width:200,height:200,blocks:[]},100,100);
    const segments=[{x1:20,y1:40,x2:180,y2:40,net:'H1'},
      {x1:50,y1:20,x2:50,y2:180,net:'H2'},
      {x1:20,y1:140,x2:180,y2:140,net:'H3'}];
    const a=diagramContinuations(tiles[0],segments),b=diagramContinuations(tiles[1],segments),c=diagramContinuations(tiles[2],segments);
    expect(a).toContainEqual(expect.objectContaining({net:'H1',side:'right',column:2,row:1}));
    expect(b).toContainEqual(expect.objectContaining({net:'H1',side:'left',column:1,row:1}));
    expect(a).toContainEqual(expect.objectContaining({net:'H2',side:'bottom',column:1,row:2}));
    expect(c).toContainEqual(expect.objectContaining({net:'H2',side:'top',column:1,row:1}));
    expect(a.some(mark=>mark.net==='H3')).toBe(false);
  });
});
