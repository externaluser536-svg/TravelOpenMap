// Категории заметок. Цвета выбраны так, чтобы читаться и на светлой, и на тёмной карте.

export interface NoteCategory {
  id: string;
  /** имя иконки lucide (см. ui/icons.ts) */
  icon: string;
  color: string;
}

export const CATEGORIES: NoteCategory[] = [
  { id: 'place', icon: 'pin', color: '#6C8CFF' },
  { id: 'sight', icon: 'landmark', color: '#C084FC' },
  { id: 'nature', icon: 'trees', color: '#3DDC97' },
  { id: 'food', icon: 'utensils', color: '#FFB547' },
  { id: 'stay', icon: 'bed', color: '#2DD4BF' },
  { id: 'transport', icon: 'train', color: '#60A5FA' },
  { id: 'photo', icon: 'camera', color: '#F472B6' },
  { id: 'danger', icon: 'triangle-alert', color: '#FF6B6B' },
  { id: 'idea', icon: 'lightbulb', color: '#FACC15' },
];

export const categoryById = (id: string): NoteCategory => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];
