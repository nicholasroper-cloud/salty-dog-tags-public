// Pure LightBurn project writer. Builds the .lbrn2 XML from a template copied from a LightBurn 2.1.03
// saved file ("Thirsty Beaches Dog Tag - Color.lbrn2", lines 4-26). No I/O. See SPEC section 7.

export const SERVICE_VERSION = '1.0.0';

// number -> string, 0.1 micron precision, no exponent, -0 -> 0
export function fmt(v) {
  const r = Math.round(v * 1e4) / 1e4;
  return String(Object.is(r, -0) ? 0 : r);
}

// Escape for an XML attribute value. Control characters are dropped; newlines become &#10;.
export function escapeAttr(s) {
  return String(s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\r\n|\r|\n/g, '&#10;')
    .replace(/\t/g, '&#9;');
}

export function vertList(verts) {
  return verts.map((v) => {
    let s = `V${fmt(v.x)} ${fmt(v.y)}`;
    s += v.c0 ? `c0x${fmt(v.c0.x)}c0y${fmt(v.c0.y)}` : 'c0x1';
    s += v.c1 ? `c1x${fmt(v.c1.x)}c1y${fmt(v.c1.y)}` : 'c1x1';
    return s;
  }).join('');
}

export function primList(prims) {
  return prims.map((p) => `${p.t}${p.a} ${p.b}`).join('');
}

function shape(sp, cutIndex) {
  return `    <Shape Type="Path" CutIndex="${cutIndex}">
        <XForm>1 0 0 1 0 0</XForm>
        <VertList>${vertList(sp.verts)}</VertList>
        <PrimList>${primList(sp.prims)}</PrimList>
    </Shape>`;
}

// LightBurn stores a bitmap's size as pixels / 2.835 (1024 px -> 361.199 in a LightBurn 2.0.05 file) and scales it to the
// real size through XForm. Verified against a user-saved file; see SPEC section 7.4.
export const BITMAP_PX_PER_UNIT = 2.835;

// One Bitmap shape. b: { png:Buffer, wPx, hPx, cutIndex, centerMm:[x,y], sizeMm:[w,h], file?:string, flipY?:bool }.
// The image is placed with its centre at centerMm (LightBurn workspace mm, Y up as in the Path shapes).
export function bitmapShape(b) {
  const W = b.wPx / BITMAP_PX_PER_UNIT, H = b.hPx / BITMAP_PX_PER_UNIT;
  const sx = b.sizeMm[0] / W, sy = b.sizeMm[1] / H * (b.flipY ? -1 : 1);
  const enhance = b.enhance === false ? '' : ' EnhanceAmount="0" EnhanceRadius="0" EnhanceDenoise="0"';
  return `    <Shape Type="Bitmap" CutIndex="${b.cutIndex}" W="${fmt(W)}" H="${fmt(H)}" Gamma="1" Contrast="0" Brightness="0"${enhance} File="${escapeAttr(b.file || '')}" SourceHash="0" Data="${b.png.toString('base64')}">
        <XForm>${fmt(sx)} 0 0 ${fmt(sy)} ${fmt(b.centerMm[0])} ${fmt(b.centerMm[1])}</XForm>
    </Shape>`;
}

const RESERVED_KEY = /^(index|name|priority|scanOpt|tabCount|tabCountMax)$/;

// opts: { deviceName, layerName, cutSetting:{key:value}, tool:[subpath], scan:[subpath], notes:string,
//         image?: { index, name, cutSetting:{key:value}, bitmaps:[bitmapShape opts] },   (image is opt-in: photo tags)
//         qr?: { index, name, cutSetting:{key:value}, shapes:[subpath] } }   (smart QR tag: the QR on its own Scan layer, crosshatch)
export const QR_LAYER_INDEX = 2;
export function buildLbrn2(opts) {
  const { deviceName, layerName, cutSetting, tool, scan, notes, image, qr } = opts;
  const fieldLines = Object.entries(cutSetting).map(([k, v]) => {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(k) || RESERVED_KEY.test(k)) throw new Error(`bad cutSetting key "${k}"`);
    return `        <${k} Value="${escapeAttr(v)}"/>`;
  }).join('\n');
  const toolShapes = tool.map((sp) => shape(sp, 30)).join('\n');
  const scanShapes = scan.map((sp) => shape(sp, 0)).join('\n');
  let imageLayer = '', imageShapes = '';
  if (image) {
    const imgFields = Object.entries(image.cutSetting).map(([k, v]) => {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(k) || RESERVED_KEY.test(k)) throw new Error(`bad image cutSetting key "${k}"`);
      return `        <${k} Value="${escapeAttr(v)}"/>`;
    }).join('\n');
    // LightBurn writes image layers as <CutSetting_Img type="Image">
    imageLayer = `    <CutSetting_Img type="Image">
        <index Value="${image.index}"/>
        <name Value="${escapeAttr(image.name)}"/>
${imgFields}
        <priority Value="2"/>
    </CutSetting_Img>
`;
    imageShapes = image.bitmaps.map((b) => bitmapShape({ ...b, cutIndex: image.index })).join('\n') + '\n';
  }
  let qrLayer = '', qrShapes = '';
  if (qr) {
    const qf = Object.entries(qr.cutSetting).map(([k, v]) => {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(k) || RESERVED_KEY.test(k)) throw new Error(`bad qr cutSetting key "${k}"`);
      return `        <${k} Value="${escapeAttr(v)}"/>`;
    }).join('\n');
    qrLayer = `    <CutSetting type="Scan">
        <index Value="${qr.index}"/>
        <name Value="${escapeAttr(qr.name)}"/>
${qf}
        <priority Value="3"/>
    </CutSetting>
`;
    qrShapes = qr.shapes.map((sp) => shape(sp, qr.index)).join('\n') + '\n';
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="2.1.03" DeviceName="${escapeAttr(deviceName)}" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False" AskForSendName="True">
    <Thumbnail Source=""/>
    <VariableText>
        <Start Value="0"/>
        <End Value="999"/>
        <Current Value="0"/>
        <Increment Value="1"/>
        <AutoAdvance Value="0"/>
    </VariableText>
    <UIPrefs>
        <Optimize_ByLayer Value="0"/>
        <Optimize_ByGroup Value="-1"/>
        <Optimize_ByPriority Value="1"/>
        <Optimize_WhichDirection Value="0"/>
        <Optimize_InnerToOuter Value="1"/>
        <Optimize_ByDirection Value="0"/>
        <Optimize_ReduceTravel Value="1"/>
        <Optimize_HideBacklash Value="0"/>
        <Optimize_ReduceDirChanges Value="0"/>
        <Optimize_ChooseCorners Value="0"/>
        <Optimize_AllowReverse Value="1"/>
        <Optimize_RemoveOverlaps Value="0"/>
        <Optimize_OptimalEntryPoint Value="0"/>
        <Optimize_OverlapDist Value="0.025"/>
    </UIPrefs>
    <CutSetting type="Scan">
        <index Value="0"/>
        <name Value="${escapeAttr(layerName)}"/>
${fieldLines}
        <priority Value="0"/>
    </CutSetting>
    <CutSetting type="Tool">
        <index Value="30"/>
        <name Value="T1 - tag outline (no output)"/>
        <priority Value="1"/>
    </CutSetting>
${imageLayer}${qrLayer}${toolShapes}
${scanShapes}
${imageShapes}${qrShapes}    <Notes ShowOnLoad="0" Notes="${escapeAttr(notes)}"/>
</LightBurnProject>
`;
}
