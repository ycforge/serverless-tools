// CJS entry fixture (spec 023 edge cases): a CommonJS module whose default
// export is a NestJS application module class. Loaded by the host-loader e2e
// under plain node (no tsx) to prove Node CJS interop; entry bootstrapping in
// the e2e asserts the server starts and answers via the connector.
module.exports = class CjsInlineAppModule {};