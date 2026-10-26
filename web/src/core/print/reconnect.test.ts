import { describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { ConnectionState } from '@src/core/print/printerClient'
import { onReconnect } from './reconnect'

function connection(initial: ConnectionState) {
  return writable<{ connection: ConnectionState }>({ connection: initial })
}

describe('onReconnect', () => {
  it('fires when the connection returns to online', () => {
    const store = connection('offline')
    const onBack = vi.fn()
    onReconnect(store, onBack)
    store.set({ connection: 'connecting' })
    expect(onBack).not.toHaveBeenCalled()
    store.set({ connection: 'online' })
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('ignores a connection that is already online when the watch begins', () => {
    const store = connection('online')
    const onBack = vi.fn()
    onReconnect(store, onBack)
    store.set({ connection: 'online' })
    expect(onBack).not.toHaveBeenCalled()
    store.set({ connection: 'offline' })
    store.set({ connection: 'online' })
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('fires on every return, and not after it is stopped', () => {
    const store = connection('offline')
    const onBack = vi.fn()
    const stop = onReconnect(store, onBack)
    store.set({ connection: 'online' })
    store.set({ connection: 'offline' })
    store.set({ connection: 'online' })
    expect(onBack).toHaveBeenCalledTimes(2)
    stop()
    store.set({ connection: 'offline' })
    store.set({ connection: 'online' })
    expect(onBack).toHaveBeenCalledTimes(2)
  })
})
