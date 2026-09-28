import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetDbForTests, deleteNote, getAllDays, getAllNotes, getMediaForNote, loadFogChunks, putDay, putMedia, putNote,
  saveFogChunks, wipeAll, type Note,
} from '../src/data/db';

const note = (id: string, t: number): Note => ({
  id, title: 'T' + id, text: '', category: 'place', lng: 7.4, lat: 43.7, createdAt: t, updatedAt: t, mediaIds: [], photos: 0, videos: 0,
});

describe('db', () => {
  beforeEach(async () => {
    _resetDbForTests();
    await wipeAll();
  });

  it('заметки: порядок «новые сверху», удаление вместе с медиа', async () => {
    await putNote(note('a', 1));
    await putNote(note('b', 2));
    await putMedia({ id: 'm1', noteId: 'a', kind: 'photo', mime: 'image/jpeg', blob: new Blob(['x']), size: 1, createdAt: 1 });
    expect((await getAllNotes()).map((n) => n.id)).toEqual(['b', 'a']);
    expect(await getMediaForNote('a')).toHaveLength(1);
    await deleteNote('a');
    expect((await getAllNotes()).map((n) => n.id)).toEqual(['b']);
    expect(await getMediaForNote('a')).toHaveLength(0);
  });

  it('туман: чанки сохраняются и читаются', async () => {
    await saveFogChunks([{ key: 5, cells: Uint16Array.from([1, 2, 3]) }]);
    const chunks = await loadFogChunks();
    expect(chunks).toHaveLength(1);
    expect([...chunks[0].cells]).toEqual([1, 2, 3]);
  });

  it('дни', async () => {
    await putDay({ date: '2026-09-28', cells: 3, areaM2: 100, distanceM: 50, notes: 1 });
    expect(await getAllDays()).toHaveLength(1);
  });
});
