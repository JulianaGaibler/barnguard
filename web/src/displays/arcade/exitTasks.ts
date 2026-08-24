/**
 * Work a game has to finish before the arcade tears it down.
 *
 * The obvious case is a game-over card holding a name the player typed but
 * never confirmed with a button. Left to the unmount, its leaderboard POST goes
 * out un-awaited and nothing can tell whether it landed. Registering it here
 * instead gives {@link runExitTasks} something to wait on.
 *
 * A module-level set rather than a prop threaded through every game: there is
 * one arcade per page, and the components that need this sit several layers
 * below the ones the shell hands props to.
 */

/**
 * How long the arcade waits before leaving a task behind.
 *
 * Above the leaderboard client's own 2 s timeout, so in the normal case that
 * one fires first and this only catches a task that hangs outright.
 */
const EXIT_TASK_TIMEOUT_MS = 3000

const tasks = new Set<() => Promise<void> | void>()

/** Register `run`, and hand back the unregister to call on teardown. */
export function registerExitTask(run: () => Promise<void> | void): () => void {
  tasks.add(run)
  return () => {
    tasks.delete(run)
  }
}

/**
 * Run every registered task and settle, whatever they do.
 *
 * Never rejects and never outlasts {@link EXIT_TASK_TIMEOUT_MS}: a return to the
 * launcher is the one thing that must always work. Tasks are left registered,
 * since each carries its own guard against running twice and unregisters when
 * its component goes away.
 */
export async function runExitTasks(): Promise<void> {
  const running = [...tasks].map((run) =>
    Promise.resolve()
      .then(run)
      .catch(() => {}),
  )
  if (running.length === 0) return
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, EXIT_TASK_TIMEOUT_MS)
  })
  await Promise.race([Promise.all(running), deadline])
  clearTimeout(timer)
}
