// The ornament page and home fragments are not built while ORNAMENT_ENABLED is false, so the ornament tests render them in-process
// with the links switched on. (The server side is switched on per call with ORNAMENTS_ON: 'true' in the env.)
import { setOrnamentLinks } from '../lib/shell.mjs';
import { renderOrnamentPage, applyHomeMarkers } from '../build-ornament.mjs';

setOrnamentLinks(true);
export const ORN_HTML = renderOrnamentPage();
export const withOrnamentHome = (homeHtml) => applyHomeMarkers(homeHtml, true);
export { applyHomeMarkers };
