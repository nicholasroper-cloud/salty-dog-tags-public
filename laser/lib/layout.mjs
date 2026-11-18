// The Node side of the shared layout module. site/tag-layout.js is a classic script so the browser
// and the service run the identical file; createRequire is how an ESM service loads it.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const SDTLayout = require('../../site/tag-layout.js');
export default SDTLayout;
