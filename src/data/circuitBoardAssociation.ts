import type { Circuit, ProjectData } from '../types';

/** Circuit membership is independent of floor drawing routes and visibility. */
export function circuitBelongsToBoard(data: ProjectData, circuit: Circuit, boardId: string): boolean {
  const board = data.boards.find(item => item.id === boardId);
  if (!board) return false;
  if (data.boards.length === 1 || circuit.boardConnections?.some(item => item.boardId === boardId)) return true;
  const id = circuit.protectionDeviceId;
  return !!id && (board.rows.some(row => row.placements.some(item => item.deviceId === id)) ||
    data.devices.some(device => device.id === id && device.boardId === boardId && device.moduleWidth !== undefined));
}
