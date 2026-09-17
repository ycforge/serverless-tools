// Committed fixture: NOT a materializer (no supports/materialize) — shape-guard
// rejects it in loadRegistry (BRG_NOT_A_PLUGIN analogue for dispatch consumers).
export default { foo: () => {} };