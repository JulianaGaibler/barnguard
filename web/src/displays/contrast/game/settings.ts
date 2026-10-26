/**
 * The algorithm the booth plays with. The attendant panel writes it and the
 * screen reads it, and it survives a reload.
 */
import { writable, type Readable } from 'svelte/store'
import type { Algorithm } from './contrast'
import { loadAlgorithm, saveAlgorithm } from './storage'

const store = writable<Algorithm>(loadAlgorithm())

export const algorithm: Readable<Algorithm> = { subscribe: store.subscribe }

export function setAlgorithm(next: Algorithm): void {
  saveAlgorithm(next)
  store.set(next)
}
