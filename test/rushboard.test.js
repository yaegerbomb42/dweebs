// rushboard.test.js — boss rush leaderboard.
import { describe, it, expect, beforeEach } from 'vitest';
import { RUSHBOARD_KEY, MAX_ENTRIES, getBoard, submitTime, clearBoard } from '../src/adventure/rushboard.js';

function mockStorage() {
  const store = {};
  globalThis.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
}

beforeEach(() => {
  delete globalThis.localStorage;
  mockStorage();
});

describe('rush leaderboard', () => {
  it('starts empty', () => {
    expect(getBoard()).toEqual([]);
  });

  it('submits times', () => {
    const r = submitTime(120.5, 'Test');
    expect(r.rank).toBe(1);
    expect(getBoard().length).toBe(1);
  });

  it('sorts fastest first', () => {
    submitTime(200);
    submitTime(100);
    submitTime(150);
    const board = getBoard();
    expect(board[0].time).toBe(100);
    expect(board[2].time).toBe(200);
  });

  it('caps at MAX_ENTRIES', () => {
    for (let i = 0; i < 15; i++) submitTime(100 + i);
    expect(getBoard().length).toBe(MAX_ENTRIES);
  });

  it('slow times do not rank', () => {
    for (let i = 0; i < MAX_ENTRIES; i++) submitTime(50);
    const r = submitTime(999);
    expect(r.rank).toBeNull();
  });

  it('clearBoard wipes', () => {
    submitTime(100);
    clearBoard();
    expect(getBoard()).toEqual([]);
  });
});
