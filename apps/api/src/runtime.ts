import { Layer, ManagedRuntime } from "effect"

// Phase A: empty layer. Sandbox, MCP host, cortex client land in Phase C.
const Main = Layer.empty

export const runtime = ManagedRuntime.make(Main)
