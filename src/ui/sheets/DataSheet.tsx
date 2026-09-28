import { useState } from 'react';
import { useApp } from '../../state/store';
import { engine } from '../../state/engine';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Row, Sheet } from '../common';
import { exportBackup, importBackup } from '../../data/backup';
import { notesToGeoJson, toGpx } from '../../core/gpx';
import { pickFile, saveFile } from '../../services/files';
import { dateKey } from '../../core/days';

export function DataSheet() {
  const { t, tn } = useT();
  const patch = useApp((s) => s.patch);
  const notes = useApp((s) => s.notes);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useApp.getState().toast;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      toast({ kind: 'error', title: t('data.failed'), text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet tall title={t('data.title')} onClose={() => patch({ sheet: null })}>
      <div className="form">
        <p className="muted">{t('data.intro')}</p>
        <h4 className="sect-sm">{t('data.backup')}</h4>
        <div className="card list">
          <Row
            icon="download"
            title={t('data.export_full')}
            sub={t('data.export_full_sub')}
            onClick={() => void run('full', async () => saveFile(`travelopenmap-backup-${dateKey()}.json`, await exportBackup(true), 'application/json'))}
            right={busy === 'full' ? <span className="spinner" /> : undefined}
          />
          <Row
            icon="download"
            title={t('data.export_light')}
            sub={t('data.export_light_sub')}
            onClick={() => void run('light', async () => saveFile(`travelopenmap-backup-${dateKey()}-light.json`, await exportBackup(false), 'application/json'))}
            right={busy === 'light' ? <span className="spinner" /> : undefined}
          />
          <Row
            icon="upload"
            title={t('data.import')}
            sub={t('data.import_sub')}
            onClick={() =>
              void run('import', async () => {
                const f = await pickFile('.json,application/json');
                if (!f) return;
                const r = await importBackup(f);
                await engine.reloadFromDb();
                toast({ kind: 'info', title: t('data.imported'), text: `${r.notes} ${tn('unit.note', r.notes)}`, icon: 'check' });
              })
            }
            right={busy === 'import' ? <span className="spinner" /> : undefined}
          />
        </div>
        <h4 className="sect-sm">{t('data.export')}</h4>
        <div className="card list">
          <Row
            icon="route"
            title={t('data.gpx')}
            sub={t('data.gpx_sub')}
            onClick={() =>
              void run('gpx', async () => {
                const gpx = toGpx(
                  engine.allTracks().map((tr) => ({ name: tr.date, points: tr.points })),
                  notes.map((n) => ({ lng: n.lng, lat: n.lat, name: n.title, desc: n.text, t: n.createdAt })),
                );
                await saveFile(`travelopenmap-${dateKey()}.gpx`, gpx, 'application/gpx+xml');
              })
            }
          />
          <Row
            icon="pin"
            title={t('data.geojson')}
            sub={t('data.geojson_sub')}
            onClick={() => void run('geo', async () => saveFile(`travelopenmap-notes-${dateKey()}.geojson`, JSON.stringify(notesToGeoJson(notes), null, 2), 'application/geo+json'))}
          />
        </div>
        <h4 className="sect-sm danger-text">{t('data.danger')}</h4>
        {confirmReset ? (
          <div className="confirm col">
            <p>{t('data.reset_q')}</p>
            <div className="row-btns">
              <button className="btn ghost grow" onClick={() => setConfirmReset(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn danger grow"
                onClick={() =>
                  void run('reset', async () => {
                    await engine.resetAll();
                    setConfirmReset(false);
                    toast({ kind: 'info', title: t('data.reset_done'), icon: 'check' });
                  })
                }
              >
                {t('data.reset')}
              </button>
            </div>
          </div>
        ) : (
          <button className="btn ghost danger-text block" onClick={() => setConfirmReset(true)}>
            <Icon name="trash" size={16} /> {t('data.reset')}
          </button>
        )}
      </div>
    </Sheet>
  );
}
