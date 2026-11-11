import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { makeDevice } from '../../catalog';
import { createProject } from '../../data/project';
import type { Board, BoardWiring, ProjectData } from '../../types';
import { WiringDiagram, useWiringDiagram } from './WiringDiagram';

const noop = () => {};
function Drawing({ data, board }: { data: ProjectData; board: Board }) {
  const wiring: BoardWiring = board.wiring ?? { wires: [], buses: [], infeeds: [] };
  const diagram = useWiringDiagram(data, board, wiring, {
    snapToGrid: false, patchWire: noop, patchBus: noop, patchInfeed: noop, patchFloorPosition: noop, placeDevice: noop,
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
  const outlet = makeDevice('outlet', [breaker]);
  data.devices.push(breaker, outlet);
  board.rows[0].placements.push({ deviceId: breaker.id, start: 0 });
  const sheet = data.sheets[0];
  sheet.boardPlacements = [{ boardId: board.id, x: 10, y: 10 }];
  sheet.placements.push({ deviceId: outlet.id, x: 200, y: 100, rotation: 0 });
  sheet.routes.push({
    id: 'route', fromBoardId: board.id, toDeviceId: outlet.id, kind: 'power', points: [],
    boardTerminals: [{ boardId: board.id, conductor: 'L', endpoint: { kind: 'device', deviceId: breaker.id, side: 'bottom', pole: 0 } }]
  });
  return { data, board, breaker };
}

describe('floor-plan connections on the wiring diagram', () => {
  it('shows the route and its assigned terminal, following the device when it moves', () => {
    const { data, board } = fixture();
    const render = () => renderToStaticMarkup(createElement(Drawing, { data, board }));
    const first = render();
    expect(first).toContain('data-floor-route-id="route"');
    expect(first).toContain('data-floor-route-link="route" data-conductor="L"');
    expect(first).toContain('Alaprajzi nyomvonal');
    const points = (markup: string) => markup.match(/data-floor-route-link="route"[^>]*>\s*<polyline points="([^"]+)/)?.[1];
    expect(points(first)).toBeDefined();
    board.rows[0].placements[0].start = 2;
    expect(points(render())).not.toEqual(points(first));
    expect(board.wiring?.wires ?? []).toHaveLength(0);
  });

  it('keeps an unplaced terminal visible as a warning without drawing a false link', () => {
    const { data, board } = fixture();
    board.rows[0].placements = [];
    const markup = renderToStaticMarkup(createElement(Drawing, { data, board }));
    expect(markup).toContain('data-floor-route-id="route"');
    expect(markup).toContain('Kapocs nem látható a rajzon');
    expect(markup).not.toContain('data-floor-route-link="route"');
  });
});
