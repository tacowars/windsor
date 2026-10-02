import { describe, expect, it } from 'vitest';
import { ExportNameMemory, openSongKey, songFileName } from './songFileName';

describe('songFileName', () => {
  it('slugs the name', () => {
    expect(songFileName('Acid sketch 3')).toBe('acid-sketch-3.json');
    expect(songFileName('  Warehouse — 04:00!  ')).toBe('warehouse-04-00.json');
    expect(songFileName('Café Ünder')).toBe('cafe-under.json');
  });

  it('names a song with no name untitled', () => {
    expect(songFileName('')).toBe('untitled.json');
    expect(songFileName(' — ')).toBe('untitled.json');
  });
});

describe('openSongKey', () => {
  it('changes with the record and with every replacement, not with a rename', () => {
    const named = openSongKey({ kind: 'named', id: 'a' }, 3);
    expect(openSongKey({ kind: 'named', id: 'a' }, 3)).toBe(named);
    expect(openSongKey({ kind: 'named', id: 'b' }, 3)).not.toBe(named);
    expect(openSongKey({ kind: 'untitled' }, 3)).not.toBe(named);
    expect(openSongKey({ kind: 'untitled' }, 4)).not.toBe(openSongKey({ kind: 'untitled' }, 3));
  });
});

describe('ExportNameMemory', () => {
  it('follows the name until the user types one', () => {
    const memory = new ExportNameMemory();
    expect(memory.value('1:a', 'Acid sketch 3')).toBe('acid-sketch-3.json');
    expect(memory.value('1:a', 'Acid sketch 4')).toBe('acid-sketch-4.json');
    memory.type('1:a', 'mine.json');
    expect(memory.value('1:a', 'Acid sketch 5')).toBe('mine.json');
  });

  it('forgets a typed name when the open song changes', () => {
    const memory = new ExportNameMemory();
    memory.type('1:a', 'mine.json');
    expect(memory.value('2:untitled', '')).toBe('untitled.json');
    expect(memory.value('1:a', 'Acid')).toBe('acid.json');
  });
});
