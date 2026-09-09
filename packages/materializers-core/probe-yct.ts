import { YMT_INVALID_QUEUE_URL, ARTIFACT_TYPES } from '@ycforge/materializers-core';

const runtimeString: string = 'anything';
type T = typeof YMT_INVALID_QUEUE_URL;
const x: T = runtimeString; // should FAIL if T is the literal 'YMT_INVALID_QUEUE_URL'

type At = (typeof ARTIFACT_TYPES)[number];
const y: At = runtimeString; // should FAIL if At is the union