import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { makeDevice } from '../../catalog';
import { createProject } from '../../data/project';
import { wireSegmentCrossesObstacle } from '../../data/boardWireRouting';
import type { Board, BoardWiring, ProjectData } from '../../types';
import { WiringDiagram, useWiringDiagram } from './WiringDiagram';

const noop = () => {};
function Drawing({ data, board }: { data: ProjectData; board: Board }) {
  const wiring: BoardWiring = board.wiring ?? { wires: [], buses: [], infeeds: [] };
  const diagram = useWiringDiagram(data, board, wiring, {
    snapToGrid: false, patchWire: noop, patchBus: noop, patchInfeed: noop, patchCircuitPosition: noop, placeDevice: noop,
  });
  return createElement(WiringDiagram, { data, board, wiring, diagram,
    selectedDeviceId: null, onPlaceDevice: noop, onSelectWire: noop, onSelectDevice: noop,
    onSelectEndpoint: noop, onReconnectEndpoint: noop, onNotify: noop });
}

function fixture() {
  const { data } = createProject();
  const board = data.boards[0];
  const breaker = makeDevice('breaker', []);
  breaker.boardId = board.id;
  breaker.moduleWidth = 1;
  breaker.electrical = { role:'mcb', poles:['L'] };
  const outlet = makeDevice('outlet', [breaker]);
  data.devices.push(breaker, outlet);
  board.rows[0].placements.push({ deviceId: breaker.id, start: 0 });
  data.circuits.push({ id:'circuit', code:'ÁK1', name:'Dugaljak', color:'#224466', notes:'', boardConnections:[{
    boardId: board.id, terminals:[{ conductor:'L', endpoint:{ kind:'device', deviceId:breaker.id, side:'bottom', pole:0 }}]
  }] });
  const sheet = data.sheets[0];
  sheet.boardPlacements = [{ boardId: board.id, x: 10, y: 10 }];
  sheet.placements.push({ deviceId: outlet.id, x: 200, y: 100, rotation: 0 });
  sheet.routes.push({
    id: 'route', fromBoardId: board.id, toDeviceId: outlet.id, kind: 'power', points: [],
    boardTerminals: [{ boardId: board.id, conductor: 'L', endpoint: { kind: 'device', deviceId: breaker.id, side: 'bottom', pole: 0 } }]
  });
  return { data, board, breaker };
}

describe('circuit connections on the wiring diagram', () => {
  it('shows the circuit and its assigned terminal, following the device when it moves', () => {
    const { data, board } = fixture();
    const render = () => renderToStaticMarkup(createElement(Drawing, { data, board }));
    const first = render();
    expect(first).toContain('data-circuit-id="circuit"');
    expect(first).toContain('data-circuit-link="circuit" data-conductor="L"');
    expect(first).not.toContain('data-floor-route-id');
    expect(first).toContain('Dugaljak');
    const points = (markup: string) => markup.match(/data-circuit-link="circuit"[^>]*>\s*<polyline class="wiring-wire-hit" points="([^"]+)/)?.[1]
      .split(' ').map(pair => pair.split(',').map(Number));
    const firstRoute = points(first);
    expect(firstRoute?.[0]).toEqual([101,230]);
    board.rows[0].placements[0].start = 2;
    const movedRoute = points(render());
    expect(movedRoute?.[0]).toEqual([193,230]);
    expect(movedRoute?.at(-1)).toEqual(firstRoute?.at(-1));
    expect(board.wiring?.wires ?? []).toHaveLength(0);
  });

  it('automatically routes the connection outside its circuit box and into its left terminal', () => {
    const { data, board } = fixture();
    const connection = data.circuits[0].boardConnections![0];
    for (const id of ['circuit','circuit1','circuit2','circuit3','circuit4','circuit5','circuit6']) for (const position of [{x:100,y:265},{x:180,y:300},{x:20,y:300},{x:300,y:270},{x:-20,y:270}]) {
      data.circuits[0].id = id;
      connection.position = position;
      const markup = renderToStaticMarkup(createElement(Drawing, {data, board}));
      const raw = markup.match(/data-circuit-link="[^"]+"[^>]*>\s*<polyline class="wiring-wire-hit" points="([^"]+)/)?.[1];
      expect(raw).toBeDefined();
      const points = raw!.split(' ').map(pair => { const [x,y] = pair.split(',').map(Number); return {x,y}; });
      const box = {...position,width:230,height:144};
      expect(points.at(-1)).toEqual({x:position.x,y:position.y+62});
      expect(points.at(-2)!.y).toBe(points.at(-1)!.y);
      expect(points.at(-2)!.x).toBeLessThan(points.at(-1)!.x);
      for (let i = 1; i < points.length; i++) expect(wireSegmentCrossesObstacle(points[i-1],points[i],box), JSON.stringify({id,position,points})).toBe(false);
    }
  });

  it('keeps an unplaced terminal visible as a warning without drawing a false link', () => {
    const { data, board } = fixture();
    board.rows[0].placements = [];
    const markup = renderToStaticMarkup(createElement(Drawing, { data, board }));
    expect(markup).toContain('data-circuit-id="circuit"');
    expect(markup).toContain('Kapocs nem látható a rajzon');
    expect(markup).not.toContain('data-circuit-link="circuit"');
  });
});
