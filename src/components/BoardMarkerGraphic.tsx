import { useState } from 'react';
import { t } from '../i18n';
import { boardImage } from '../products/boardImage';
import type { Board, FloorPlanDisplay } from '../types';

/** Floor-plan cabinet marker, shared by both display modes. */
export function BoardMarkerGraphic({ board, display, selected }: { board: Board; display: FloorPlanDisplay; selected: boolean }) {
  const picture = display === 'images' ? boardImage(board) : undefined;
  const [failed, setFailed] = useState<string>();
  const showPicture = picture && picture.src !== failed;
  return <>
    {showPicture ? <>
      <rect x={-40} y={-40} width={80} height={80} rx={3} fill="white" stroke="#28775b" strokeWidth={selected ? 4 : 1}/>
      <image href={picture.src} x={-38} y={-38} width={76} height={76} preserveAspectRatio="xMidYMid meet" pointerEvents="none" onError={() => setFailed(picture.src)} />
      {picture.illustrative && <text x={35} y={-28} textAnchor="end" fontSize={11} fontWeight={700} fill="#1b563e" pointerEvents="none"><title>{t('Termékcsalád illusztrációja')}</title>I</text>}
    </> : <>
      <rect x={-18} y={-22} width={36} height={44} rx={3} fill="#f2faf5" stroke="#28775b" strokeWidth={selected ? 4 : 2}/>
      <path d="M-11 -10H11 M-11 0H11 M-11 10H11" fill="none" stroke="#28775b" strokeWidth={2}/>
    </>}
    <text x={0} y={showPicture ? 54 : 38} textAnchor="middle" fontSize={11} fontWeight={600} fill="#344d40" stroke="white" strokeWidth={3} paintOrder="stroke" pointerEvents="none">{board.name}</text>
  </>;
}
