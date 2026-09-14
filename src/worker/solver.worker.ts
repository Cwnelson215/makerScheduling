import { handleRequest } from './handler'
import type { SolveRequest, SolveResponse } from './protocol'

// The project's lib is DOM, not WebWorker (the two conflict), so describe the worker scope
// by the two members actually used.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SolveRequest>) => void) | null
  postMessage(message: SolveResponse): void
}

scope.onmessage = (event) => handleRequest(event.data, (response) => scope.postMessage(response))
