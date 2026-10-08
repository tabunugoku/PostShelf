import { describe, expect, it } from 'vitest';
import { moveBefore, pruneSelection, rangeIds } from '../src/manager/selection';

describe('selection helpers', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  it('rangeIds is order-independent and inclusive', () => {
    expect(rangeIds(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(order, null, 'c')).toEqual(['c']);
    expect(rangeIds(order, 'zzz', 'c')).toEqual(['c']);
    expect(rangeIds(order, 'a', 'nope')).toEqual([]);
  });
  it('moveBefore reorders', () => {
    expect(moveBefore(order, 'd', 'b')).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(moveBefore(order, 'a', 'e')).toEqual(['b', 'c', 'd', 'a', 'e']);
    expect(moveBefore(order, 'a', 'a')).toBe(order);
    expect(moveBefore(order, 'x', 'a')).toBe(order);
  });
  it('pruneSelection drops vanished ids', () => {
    expect([...pruneSelection(new Set(['a', 'z']), new Set(['a', 'b']))]).toEqual(['a']);
  });
});
