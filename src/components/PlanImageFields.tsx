import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { t } from '../i18n';
import { DEFAULT_PLAN_IMAGE_SIZE, isPlanImageAsset } from '../data/planAppearance';
import { floorProductImage } from '../products/floorImage';
import type { Asset, Device } from '../types';

interface Props {
  device: Device;
  assets: Record<string, Asset>;
  onChange: (image: Device['planImage']) => void;
  onUpload: (file: File) => void;
}

export function PlanImageFields({ device, assets, onChange, onUpload }: Props) {
  const uploadInput = useRef<HTMLInputElement>(null);
  const image = device.planImage;
  const catalogue = image ? undefined : floorProductImage(device);
  const asset = image ? assets[image.assetId] : catalogue?.asset;
  const [failedPreview, setFailedPreview] = useState<string>();
  const photos = device.photoIds.map(id => assets[id]).filter(isPlanImageAsset);
  const selectPhoto = (assetId: string) => onChange({
    assetId,
    size: image?.size ?? DEFAULT_PLAN_IMAGE_SIZE,
    opacity: image?.opacity ?? 1,
  });

  return <section className="plan-image-fields" aria-label={t('Alaprajzi megjelenítési kép')}>
    <div className="section-label"><strong>{t('Alaprajzi megjelenítési kép')}</strong></div>
    <p className="subtle">{t('Ez a kép jelenik meg a Valós képek nézetben és annak PDF-exportjában.')}</p>
    {isPlanImageAsset(asset) && failedPreview !== asset.data && <div className="plan-image-preview">
      <img src={asset.data} onError={() => setFailedPreview(asset.data)} alt={t('Az eszköz alaprajzi képe: {name}', { name: asset.name })}/>
      <span>{asset.name}</span>
    </div>}
    {catalogue && <p className="subtle">{t('A hozzárendelt gyártói termék képe automatikusan jelenik meg; saját kép feltöltésével lecserélheted.')}{catalogue.illustrative && <> {t('Termékcsalád illusztrációja')}.</>}</p>}
    {image && (!isPlanImageAsset(asset) || failedPreview === asset.data) && <p className="input-warning">{t('Az alaprajzi kép hiányzik vagy nem olvasható. Tölts fel vagy válassz másik képet.')}</p>}
    <div className="plan-image-actions">
      <button type="button" className="quiet" onClick={() => uploadInput.current?.click()}><ImagePlus size={17}/>{t('Kép feltöltése')}</button>
      <input ref={uploadInput} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label={t('Alaprajzi kép feltöltése')} onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) onUpload(file);
      }}/>
      {image && <button type="button" className="quiet" onClick={() => onChange(undefined)} aria-label={t('Alaprajzi kép eltávolítása')}><Trash2 size={16}/>{t('Kép eltávolítása')}</button>}
    </div>
    {!!photos.length && <div className="plan-image-photo-options">
      <p className="subtle">{t('Vagy válassz az eszköz helyszíni fotói közül:')}</p>
      <div className="plan-image-photo-grid">{photos.map(photo => <button key={photo.id} type="button" aria-label={t('Alaprajzi kép kiválasztása: {name}', { name: photo.name })} aria-pressed={image?.assetId === photo.id} title={photo.name} onClick={() => selectPhoto(photo.id)}><img src={photo.data} alt=""/></button>)}</div>
    </div>}
    {image && <div className="plan-image-settings">
      <label>{t('Képméret az alaprajzon')}<input aria-label={t('Képméret az alaprajzon')} type="number" min="24" max="240" step="1" value={image.size} onChange={event => {
        const size = Number(event.target.value);
        if (event.target.value !== '' && Number.isFinite(size) && size >= 24 && size <= 240) onChange({ ...image, size });
      }}/></label>
      <label>{t('Kép fedettsége (%)')}<input aria-label={t('Kép fedettsége (%)')} type="number" min="10" max="100" step="1" value={Math.round(image.opacity * 100)} onChange={event => {
        const opacity = Number(event.target.value) / 100;
        if (event.target.value !== '' && Number.isFinite(opacity) && opacity >= .1 && opacity <= 1) onChange({ ...image, opacity });
      }}/></label>
    </div>}
  </section>;
}
