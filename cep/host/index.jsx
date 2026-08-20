/*
 * Wallmaker - After Effects host script (ExtendScript / ES3).
 * The panel (client/) plans the whole wall (grid, thresholds, offsets) and hands this script
 * a wall JSON; this script turns it into footage, layers, masks and expressions.
 *
 * Entry points (called by the panel through CSInterface.evalScript):
 *   WALLMAKER.info()           -> JSON with AE / project info
 *   WALLMAKER.begin(argsJson)  -> loads the wall plan, prepares folder/comp/controls null
 *   WALLMAKER.step(argsJson)   -> imports footage and builds a batch of screens
 *   WALLMAKER.finish()         -> layer ordering, cleanup, opens the comp
 *   WALLMAKER.remove(argsJson) -> deletes a build (folder + comps) from the project
 *   WALLMAKER.snapshot(argsJson) -> saves one comp frame as PNG (testing)
 *   WALLMAKER.probe(argsJson)  -> evaluated opacity/position of every screen at a time (testing)
 *
 * ES3 rules: ASCII only, no trailing commas, no array methods, semicolons everywhere.
 */

/* eslint-disable */

$.global.WALLMAKER_JSON = (function () {
  function quote(s) {
    s = String(s);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      var code = s.charCodeAt(i);
      if (c === '"') out += '\\"';
      else if (c === '\\') out += '\\\\';
      else if (c === '\n') out += '\\n';
      else if (c === '\r') out += '\\r';
      else if (c === '\t') out += '\\t';
      else if (code < 32) out += '\\u' + ('0000' + code.toString(16)).slice(-4);
      else out += c;
    }
    return '"' + out + '"';
  }
  function stringify(v) {
    if (v === null || v === undefined) return 'null';
    var t = typeof v;
    if (t === 'number') return isFinite(v) ? String(v) : 'null';
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'string') return quote(v);
    if (v instanceof Array) {
      var a = [];
      for (var i = 0; i < v.length; i++) a.push(stringify(v[i]));
      return '[' + a.join(',') + ']';
    }
    if (t === 'object') {
      var o = [];
      for (var k in v) if (v.hasOwnProperty(k) && typeof v[k] !== 'function') o.push(quote(k) + ':' + stringify(v[k]));
      return '{' + o.join(',') + '}';
    }
    return 'null';
  }
  function parse(s) {
    if (s === null || s === undefined || s === '') return null;
    return eval('(' + s + ')');
  }
  return { quote: quote, stringify: stringify, parse: parse };
})();

$.global.WALLMAKER = (function () {
  var VERSION = '1.0.0';
  var TAG = 'wallmaker';
  var CTL = 'Wallmaker Controls'; // the null everything is parented to; its sliders drive the expressions
  var FOCUS = 'Wallmaker Focus'; // optional spotlight null: nearby screens zoom, far ones dim
  var J = WALLMAKER_JSON;
  var st = null; // current build state

  // ---------------------------------------------------------------- utilities

  function reply(o) {
    return J.stringify(o);
  }
  function args(json) {
    var a = J.parse(json);
    return a || {};
  }
  function readFile(path) {
    var f = new File(path);
    if (!f.exists) throw new Error('File not found: ' + path);
    f.encoding = 'UTF-8';
    if (!f.open('r')) throw new Error('Could not open ' + path);
    var s = f.read();
    f.close();
    return s;
  }
  function num(v, d) {
    return typeof v === 'number' && isFinite(v) ? v : d;
  }
  function q(sv) {
    // string literal for an expression source
    return '"' + String(sv).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  function aeVersion() {
    var m = String(app.version).match(/^(\d+)\.(\d+)/);
    return m ? parseFloat(m[1] + '.' + m[2]) : 0;
  }
  function isOurs(x) {
    return !!x && typeof x.comment === 'string' && x.comment.indexOf(TAG) === 0;
  }
  function tf(layer) {
    return layer.property('ADBE Transform Group');
  }
  function pad3(n, width) {
    var s = String(n);
    while (s.length < width) s = '0' + s;
    return s;
  }
  function removeItemDeep(item) {
    if (item instanceof FolderItem) {
      for (var i = item.numItems; i >= 1; i--) removeItemDeep(item.item(i));
    }
    item.remove();
  }
  function findCompByName(name) {
    var items = app.project.items;
    for (var i = 1; i <= items.length; i++) if (items[i] instanceof CompItem && items[i].name === name) return items[i];
    return null;
  }

  // ---------------------------------------------------------------- expressions

  /** Control accessor baked into every expression: reads a slider on the Controls null, falls back
   *  to the built value if the null was renamed (climbs the parent chain) or removed entirely. */
  function exprLib() {
    return (
      'function C(nm, df) {\n' +
      '  var v = df;\n' +
      '  try { v = thisComp.layer(' + q(CTL) + ').effect(nm)(1).value; }\n' +
      '  catch (e) { try { var n = thisLayer; while (n.parent != null) { n = n.parent; } v = n.effect(nm)(1).value; } catch (e2) {} }\n' +
      '  return v;\n' +
      '}\n'
    );
  }

  /** Shared turn-on timing: when does this screen come alive, and how far into its animation are we. */
  function turnOnSnippet(th) {
    var r = st.data.reveal;
    return (
      'var S = C(' + q('Reveal start (s)') + ', ' + num(r.start, 0) + ');\n' +
      'var D = C(' + q('Reveal duration (s)') + ', ' + num(r.duration, 0) + ');\n' +
      'var F = Math.max(1, C(' + q('Turn-on (frames)') + ', ' + num(r.animFrames, 8) + ')) * thisComp.frameDuration;\n' +
      'var t0 = S + ' + th + ' / 100 * D;\n' +
      'var dt = time - t0;\n' +
      'var p = Math.min(1, Math.max(0, dt / F));\n'
    );
  }

  function positionExpr(row, col) {
    var g = st.data.grid;
    return (
      exprLib() +
      'var gap = C(' + q('Gap (px)') + ', ' + num(g.gap, 0) + ');\n' +
      'var x = (' + col + ' - ' + ((g.cols - 1) / 2) + ') * (' + g.cellW + ' + gap);\n' +
      'var y = (' + row + ' - ' + ((g.rows - 1) / 2) + ') * (' + g.cellH + ' + gap);\n' +
      '[x, y]'
    );
  }

  function scaleExpr(bsx, bsy, screen) {
    var pop = st.data.reveal.style === 'pop';
    var body = exprLib() + 'var m = C(' + q('Screen scale (%)') + ', 100) / 100;\nvar e = 1;\n';
    if (pop) {
      body +=
        turnOnSnippet(screen.th) +
        'if (dt < 0) { e = 0; } else { var c1 = 1.70158; var c3 = c1 + 1; e = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); if (e < 0) e = 0; }\n';
    }
    if (st.data.focus) {
      body +=
        'var fz = 1;\n' +
        'try {\n' +
        '  var FL = thisComp.layer(' + q(FOCUS) + ');\n' +
        '  var FR = Math.max(1, C(' + q('Focus radius (px)') + ', ' + num(st.data.focus.radius, 400) + '));\n' +
        '  var FZ = C(' + q('Focus zoom (%)') + ', ' + num(st.data.focus.zoom, 135) + ') / 100;\n' +
        '  var dv = transform.position - FL.transform.position;\n' +
        '  var dd = Math.sqrt(dv[0] * dv[0] + dv[1] * dv[1]);\n' +
        '  var fk = Math.max(0, 1 - dd / FR);\n' +
        '  fk = fk * fk * (3 - 2 * fk);\n' +
        '  fz = 1 + (FZ - 1) * fk;\n' +
        '} catch (eF) {}\n';
      body += '[' + bsx + ' * m * e * fz, ' + bsy + ' * m * e * fz]';
    } else {
      body += '[' + bsx + ' * m * e, ' + bsy + ' * m * e]';
    }
    return body;
  }

  function opacityExpr(screen) {
    var r = st.data.reveal;
    var style = r.style;
    var body =
      exprLib() +
      turnOnSnippet(screen.th) +
      'var OP = C(' + q('Screens opacity (%)') + ', 100);\n' +
      'var dead = (' + screen.dead + ' * 100 < C(' + q('Dead screens (%)') + ', ' + num(r.deadPct, 0) + '));\n' +
      'var on = 0;\n' +
      'if (!dead && dt >= 0) {\n';
    if (style === 'fade') {
      body += '  on = p;\n';
    } else if (style === 'flicker') {
      body +=
        '  if (p >= 1) { on = 1; }\n' +
        '  else {\n' +
        '    var fr = Math.floor(dt / thisComp.frameDuration);\n' +
        '    seedRandom(' + screen.i + ' * 971 + fr, true);\n' +
        '    var r1 = random();\n' +
        '    var r2 = random();\n' +
        '    on = (r1 < 0.25 + 0.75 * p * p) ? (0.55 + 0.45 * r2) : 0;\n' +
        '  }\n';
    } else {
      body += '  on = 1;\n'; // cut / pop (pop animates on scale)
    }
    body += '}\n';
    body +=
      'if (on >= 1) {\n' +
      '  var DR = C(' + q('Dropouts (%)') + ', ' + num(r.dropouts, 0) + ');\n' +
      '  if (DR > 0) {\n' +
      '    var blk = Math.floor(time);\n' +
      '    seedRandom(' + screen.i + ' * 577 + blk * 131, true);\n' +
      '    if (random() < DR / 100 * 0.6) {\n' +
      '      var bs = blk + random() * 0.8;\n' +
      '      var bl = 0.06 + random() * 0.18;\n' +
      '      if (time >= bs && time <= bs + bl) on = 0;\n' +
      '    }\n' +
      '  }\n' +
      '}\n';
    if (st.data.focus) {
      body +=
        'var fd = 1;\n' +
        'try {\n' +
        '  var FL = thisComp.layer(' + q(FOCUS) + ');\n' +
        '  var FR = Math.max(1, C(' + q('Focus radius (px)') + ', ' + num(st.data.focus.radius, 400) + '));\n' +
        '  var DM = C(' + q('Focus dim (%)') + ', ' + num(st.data.focus.dim, 0) + ') / 100;\n' +
        '  var dv = transform.position - FL.transform.position;\n' +
        '  var dd = Math.sqrt(dv[0] * dv[0] + dv[1] * dv[1]);\n' +
        '  var fk = Math.max(0, 1 - dd / FR);\n' +
        '  fk = fk * fk * (3 - 2 * fk);\n' +
        '  fd = 1 - Math.min(1, Math.max(0, DM)) * (1 - fk);\n' +
        '} catch (eF) {}\n' +
        'on * OP * fd';
    } else {
      body += 'on * OP';
    }
    return body;
  }

  function labelOpacityExpr() {
    return (
      exprLib() +
      'var po = 0;\n' +
      'try { po = thisLayer.parent.transform.opacity; } catch (e) {}\n' +
      'po * C(' + q('Label opacity (%)') + ', 100) / 100'
    );
  }

  // ---------------------------------------------------------------- masks & shapes

  /** Rounded-rectangle mask path (kappa arcs); rx/ry let a stretched screen keep round corners. */
  function roundedRectShape(x0, y0, x1, y1, rx, ry) {
    var sh = new Shape();
    rx = Math.max(0, Math.min(rx, (x1 - x0) / 2));
    ry = Math.max(0, Math.min(ry, (y1 - y0) / 2));
    if (rx < 0.01 || ry < 0.01) {
      sh.vertices = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      sh.inTangents = [[0, 0], [0, 0], [0, 0], [0, 0]];
      sh.outTangents = [[0, 0], [0, 0], [0, 0], [0, 0]];
    } else {
      var kx = rx * 0.5523;
      var ky = ry * 0.5523;
      sh.vertices = [
        [x0 + rx, y0], [x1 - rx, y0],
        [x1, y0 + ry], [x1, y1 - ry],
        [x1 - rx, y1], [x0 + rx, y1],
        [x0, y1 - ry], [x0, y0 + ry]
      ];
      sh.inTangents = [
        [-kx, 0], [0, 0],
        [0, -ky], [0, 0],
        [kx, 0], [0, 0],
        [0, ky], [0, 0]
      ];
      sh.outTangents = [
        [0, 0], [kx, 0],
        [0, 0], [0, ky],
        [0, 0], [-kx, 0],
        [0, 0], [0, -ky]
      ];
    }
    sh.closed = true;
    return sh;
  }

  function addCropMask(layer, x0, y0, x1, y1, rx, ry) {
    var mask = layer.property('ADBE Mask Parade').addProperty('ADBE Mask Atom');
    mask.name = 'screen';
    mask.maskMode = MaskMode.ADD;
    mask.property('ADBE Mask Shape').setValue(roundedRectShape(x0, y0, x1, y1, rx, ry));
    return mask;
  }

  // ---------------------------------------------------------------- controls null

  function addSlider(fx, name, val) {
    for (var i = 1; i <= fx.numProperties; i++) {
      if (fx.property(i).name === name) return fx.property(i); // rebuild: keep the user's value / keyframes
    }
    var e = fx.addProperty('ADBE Slider Control');
    e.name = name;
    e.property(1).setValue(val);
    return e;
  }

  function ensureControls(comp) {
    var d = st.data;
    var ctl = null;
    for (var i = 1; i <= comp.numLayers; i++) {
      var l = comp.layer(i);
      if (isOurs(l) && l.comment.indexOf(TAG + '-controls') === 0) {
        ctl = l;
        break;
      }
    }
    if (!ctl) {
      ctl = comp.layers.addNull(comp.duration);
      ctl.name = CTL;
      ctl.comment = TAG + '-controls';
      tf(ctl).property('ADBE Anchor Point').setValue([0, 0]);
      tf(ctl).property('ADBE Position').setValue([d.frame.w / 2, d.frame.h / 2]);
    }
    ctl.enabled = false; // nulls are invisible anyway; keep the switch off so it never renders
    try {
      ctl.startTime = 0;
      ctl.inPoint = 0;
      ctl.outPoint = comp.duration; // a kept null must span a comp that grew on rebuild
    } catch (eSpan) {}
    var fx = ctl.property('ADBE Effect Parade');
    addSlider(fx, 'Reveal start (s)', num(d.reveal.start, 0));
    addSlider(fx, 'Reveal duration (s)', num(d.reveal.duration, 0));
    addSlider(fx, 'Turn-on (frames)', num(d.reveal.animFrames, 8));
    addSlider(fx, 'Dead screens (%)', num(d.reveal.deadPct, 0));
    addSlider(fx, 'Gap (px)', num(d.grid.gap, 0));
    addSlider(fx, 'Screen scale (%)', 100);
    addSlider(fx, 'Screens opacity (%)', 100);
    if (d.labels) addSlider(fx, 'Label opacity (%)', 100);
    if (d.bg.mode === 'static') addSlider(fx, 'Static brightness (%)', num(d.bg.staticBrightness, 14));
    if (d.reveal.dropouts > 0) addSlider(fx, 'Dropouts (%)', num(d.reveal.dropouts, 0));
    if (d.borders) addSlider(fx, 'Border (px)', num(d.borders.width, 2));
    if (d.scanlines) addSlider(fx, 'Scanlines (%)', num(d.scanlines.strength, 25));
    if (d.focus) {
      addSlider(fx, 'Focus radius (px)', num(d.focus.radius, 400));
      addSlider(fx, 'Focus zoom (%)', num(d.focus.zoom, 135));
      addSlider(fx, 'Focus dim (%)', num(d.focus.dim, 0));
    }
    return ctl;
  }

  /** The draggable spotlight null (only when the feature is on). Kept across rebuilds like the Controls null. */
  function ensureFocusNull(comp) {
    if (!st.data.focus) return null;
    for (var i = 1; i <= comp.numLayers; i++) {
      var l = comp.layer(i);
      if (isOurs(l) && l.comment.indexOf(TAG + '-focus') === 0) {
        try {
          l.startTime = 0;
          l.inPoint = 0;
          l.outPoint = comp.duration;
        } catch (eSpan2) {}
        return l;
      }
    }
    var f = comp.layers.addNull(comp.duration);
    f.name = FOCUS;
    f.comment = TAG + '-focus';
    f.parent = st.ctl;
    tf(f).property('ADBE Anchor Point').setValue([0, 0]);
    tf(f).property('ADBE Position').setValue([0, 0]);
    return f;
  }

  // ---------------------------------------------------------------- footage

  function importVideo(path) {
    if (st.footage[path]) return st.footage[path];
    var f = new File(path);
    if (!f.exists) throw new Error('Missing video: ' + path);
    var io = new ImportOptions(f);
    io.importAs = ImportAsType.FOOTAGE;
    var it = app.project.importFile(io);
    it.parentFolder = st.footFolder;
    it.comment = TAG + '-footage';
    return prepareFootage(path, it);
  }

  /** Records the un-looped source duration (offsets are fractions of THAT), then applies enough
   *  loops that any offset still leaves a full comp's worth of media. */
  function prepareFootage(path, it) {
    var srcDur = it.mainSource.isStill ? 0 : it.duration;
    if (srcDur > 0) {
      try {
        if (it.mainSource.loop > 1) {
          srcDur = srcDur / it.mainSource.loop; // reused from a previous build: duration is already multiplied
        }
        // set the loop we need now -- and RESET a stale loop when looping is off this build
        it.mainSource.loop = st.data.loop ? Math.max(1, Math.min(9999, Math.ceil((st.data.durationSec + srcDur) / srcDur) + 1)) : 1;
      } catch (e) {}
    }
    var rec = { item: it, srcDur: srcDur };
    st.footage[path] = rec;
    return rec;
  }

  /** A comp from the user's project used as a screen source (never moved / reinterpreted). */
  function sourceComp(vid) {
    var key = 'comp:' + vid.compId;
    if (st.footage[key]) return st.footage[key];
    var it = app.project.itemByID(vid.compId);
    if (!it || !(it instanceof CompItem)) throw new Error('comp not found in this project');
    if (it === st.main) throw new Error('the wall cannot use itself as a source');
    var rec = { item: it, srcDur: Math.max(0.01, it.duration), isComp: true };
    st.footage[key] = rec;
    return rec;
  }

  /** On a rebuild, reuse footage already sitting in our folder instead of importing again. */
  function indexExistingFootage() {
    if (!st.footFolder) return;
    for (var i = 1; i <= st.footFolder.numItems; i++) {
      var it = st.footFolder.item(i);
      if (it instanceof FootageItem && it.mainSource && it.mainSource.file) {
        try {
          prepareFootage(it.mainSource.file.fsName.replace(/\\/g, '/'), it);
        } catch (e) {}
      }
    }
  }

  // ---------------------------------------------------------------- screens

  function buildScreen(idx) {
    var d = st.data;
    var s = d.screens[idx];
    var vid = d.videos[s.v];
    var rec;
    try {
      rec = vid.compId ? sourceComp(vid) : importVideo(vid.path);
      if (!rec.isComp && !rec.item.hasVideo) throw new Error('no video track');
    } catch (e) {
      st.skipped.push(vid.name + ' (' + String(e && e.message ? e.message : e) + ')');
      return;
    }
    var it = rec.item;
    var sw = Math.max(1, it.width);
    var sh = Math.max(1, it.height);
    var span = Math.max(1, num(s.span, 1));
    var cw = d.grid.cellW * span + d.grid.gap * (span - 1);
    var ch = d.grid.cellH * span + d.grid.gap * (span - 1);
    var sx, sy;
    if (d.fill === 'stretch') {
      sx = cw / sw;
      sy = ch / sh;
    } else if (d.fill === 'contain') {
      sx = sy = Math.min(cw / sw, ch / sh);
    } else {
      sx = sy = Math.max(cw / sw, ch / sh);
    }
    var layer = st.main.layers.add(it);
    layer.name = 'Screen ' + pad3(idx + 1, st.padWidth) + ' \u00b7 ' + vid.name;
    layer.comment = TAG + '-screen ' + idx;

    // timing: random start point inside the SOURCE (not the looped span), then hold the comp span
    var off = 0;
    if (rec.srcDur > 0 && s.offset > 0) {
      off = Math.round(s.offset * rec.srcDur * d.fps) / d.fps;
    }
    if (rec.isComp) {
      // comps can't loop through footage interpretation -- remap time instead.
      // NOTE: time remap must be enabled BEFORE extending outPoint, or AE clamps it to the source span.
      try {
        if (d.loop || off > 0) {
          layer.timeRemapEnabled = true;
          var trP = layer.property('ADBE Time Remapping');
          if (d.loop) {
            trP.expression = '(' + off + ' + time) % ' + Math.max(0.01, rec.srcDur - 1 / d.fps) + ';';
          } else {
            trP.expression = 'Math.min(' + Math.max(0, rec.srcDur - 1 / d.fps) + ', ' + off + ' + time);';
          }
        }
        layer.inPoint = 0;
        layer.outPoint = d.loop ? d.durationSec : Math.min(d.durationSec, Math.max(1 / d.fps, rec.srcDur - off));
      } catch (eTR) {}
    } else {
      layer.startTime = -off;
      if (!it.mainSource.isStill) {
        try {
          layer.inPoint = 0;
          layer.outPoint = Math.min(d.durationSec, Math.max(0.01, it.duration - off));
        } catch (e) {}
      }
    }
    if (d.mute) {
      try {
        if (layer.hasAudio) layer.audioEnabled = false;
      } catch (e) {}
    }

    // geometry: anchored at the source center, cropped to the visible cell region
    var vw = Math.min(sw, cw / sx);
    var vh = Math.min(sh, ch / sy);
    var x0 = (sw - vw) / 2;
    var y0 = (sh - vh) / 2;
    addCropMask(layer, x0, y0, x0 + vw, y0 + vh, d.cornerRadius / sx, d.cornerRadius / sy);
    layer.parent = st.ctl;
    tf(layer).property('ADBE Anchor Point').setValue([sw / 2, sh / 2]);
    var rowF = s.row + (span - 1) / 2;
    var colF = s.col + (span - 1) / 2;
    var posP = tf(layer).property('ADBE Position');
    posP.setValue([(colF - (d.grid.cols - 1) / 2) * (d.grid.cellW + d.grid.gap), (rowF - (d.grid.rows - 1) / 2) * (d.grid.cellH + d.grid.gap)]);
    posP.expression = positionExpr(rowF, colF);
    var sclP = tf(layer).property('ADBE Scale');
    sclP.setValue([sx * 100, sy * 100]);
    sclP.expression = scaleExpr(sx * 100, sy * 100, s);
    tf(layer).property('ADBE Opacity').expression = opacityExpr(s);

    if (d.labels) buildLabel(idx, layer, sx, sy, vw, vh, x0, y0);
    st.built++;
  }

  function labelTemplate() {
    if (st.labelTpl) return st.labelTpl;
    var d = st.data;
    var l = st.main.layers.addText('CAM 000');
    l.name = '\u00b7label template';
    l.comment = TAG + '-labeltpl';
    l.enabled = false;
    var td = l.property('ADBE Text Properties').property('ADBE Text Document').value;
    td.fontSize = Math.max(7, Math.min(72, Math.round(d.grid.cellH * 0.14)));
    td.applyFill = true;
    td.fillColor = [1, 1, 1];
    td.applyStroke = false;
    var fonts = ['Menlo-Regular', 'Consolas', 'CourierNewPSMT', 'Courier'];
    for (var i = 0; i < fonts.length; i++) {
      try {
        td.font = fonts[i];
        break;
      } catch (e) {}
    }
    // one TextDocument write total (AE leaks undo objects per scripted TextDocument set -- see TwitchSim notes)
    l.property('ADBE Text Properties').property('ADBE Text Document').setValue(td);
    st.labelTpl = l;
    return l;
  }

  function buildLabel(idx, screenLayer, sx, sy, vw, vh, x0, y0) {
    var d = st.data;
    var tpl = labelTemplate();
    var l = tpl.duplicate();
    l.name = 'Label ' + pad3(idx + 1, st.padWidth);
    l.comment = TAG + '-label ' + idx;
    l.enabled = true;
    l.moveBefore(screenLayer);
    var prefix = d.labels && d.labels.prefix ? d.labels.prefix : 'CAM';
    l.property('ADBE Text Properties').property('ADBE Text Document').expression = q(prefix + ' ' + pad3(idx + 1, st.padWidth));
    l.parent = screenLayer;
    var pad = Math.max(2, d.grid.cellH * 0.07);
    tf(l).property('ADBE Position').setValue([x0 + pad / sx, y0 + vh - pad / sy]);
    tf(l).property('ADBE Scale').setValue([100 / sx, 100 / sy]);
    tf(l).property('ADBE Opacity').expression = labelOpacityExpr();
  }

  // ---------------------------------------------------------------- background / static

  function buildBackground() {
    var d = st.data;
    if (d.bg.mode === 'transparent') return;
    var bg = st.main.layers.addSolid([d.bg.color[0], d.bg.color[1], d.bg.color[2]], 'Background', d.frame.w, d.frame.h, 1, st.main.duration);
    bg.comment = TAG + '-bg';
    try {
      bg.source.parentFolder = st.root;
      bg.source.comment = TAG + '-solid';
    } catch (e) {}
    st.bgLayer = bg;
    if (d.bg.mode === 'static') buildStatic();
  }

  function buildStatic() {
    var d = st.data;
    var w = Math.max(4, Math.round(d.grid.wallW));
    var h = Math.max(4, Math.round(d.grid.wallH));
    var sc = app.project.items.addComp('Wallmaker static (' + d.compName + ')', w, h, 1, st.main.duration, d.fps);
    sc.parentFolder = st.root;
    sc.comment = TAG + '-staticcomp';
    var solid = sc.layers.addSolid([0.5, 0.5, 0.5], 'noise', w, h, 1, sc.duration);
    try {
      solid.source.parentFolder = st.root;
      solid.source.comment = TAG + '-solid';
    } catch (eS) {}
    var fx = solid.property('ADBE Effect Parade').addProperty('ADBE Fractal Noise');
    try {
      fx.property('Contrast').setValue(400);
    } catch (e) {}
    try {
      fx.property('Brightness').setValue(-40);
    } catch (e) {}
    try {
      fx.property('Transform').property('Scale').setValue(8);
    } catch (e) {}
    try {
      fx.property('Evolution').expression = 'time * 3600';
    } catch (e) {}
    var l = st.main.layers.add(sc);
    l.name = 'Static';
    l.comment = TAG + '-staticlayer';
    l.parent = st.ctl;
    tf(l).property('ADBE Position').setValue([0, 0]);
    tf(l).property('ADBE Opacity').expression = exprLib() + 'C(' + q('Static brightness (%)') + ', ' + num(d.bg.staticBrightness, 14) + ')';
    st.staticLayer = l;
  }

  /** One shape layer for every cell frame: a stroked rect + two repeaters (cols x rows), all
   *  live-linked to the Gap slider. Sits UNDER the screens: visible in gaps and on off screens. */
  function buildBorders() {
    var d = st.data;
    if (!d.borders) return;
    var l = st.main.layers.addShape();
    l.name = 'Borders';
    l.comment = TAG + '-borders';
    l.parent = st.ctl;
    tf(l).property('ADBE Position').setValue([0, 0]);
    var contents = l.property('ADBE Root Vectors Group');
    var lib = exprLib();
    var gapRef = 'C(' + q('Gap (px)') + ', ' + num(d.grid.gap, 0) + ')';
    var widthRef = 'C(' + q('Border (px)') + ', ' + num(d.borders.width, 2) + ')';
    function addCellGroup(name, w, h, posExprBody, copies) {
      var grp = contents.addProperty('ADBE Vector Group');
      grp.name = name;
      var gg = grp.property('ADBE Vectors Group');
      var rect = gg.addProperty('ADBE Vector Shape - Rect');
      rect.property('ADBE Vector Rect Size').setValue([w, h]);
      rect.property('ADBE Vector Rect Position').setValue([0, 0]);
      rect.property('ADBE Vector Rect Roundness').setValue(num(d.cornerRadius, 0));
      var stroke = gg.addProperty('ADBE Vector Graphic - Stroke');
      stroke.property('ADBE Vector Stroke Color').setValue([d.borders.color[0], d.borders.color[1], d.borders.color[2], 1]);
      stroke.property('ADBE Vector Stroke Width').setValue(num(d.borders.width, 2));
      try {
        stroke.property('ADBE Vector Stroke Width').expression = lib + widthRef;
      } catch (e) {}
      if (copies) {
        var rep1 = gg.addProperty('ADBE Vector Filter - Repeater');
        rep1.property('ADBE Vector Repeater Copies').setValue(d.grid.cols);
        var rt1 = rep1.property('ADBE Vector Repeater Transform');
        rt1.property('ADBE Vector Repeater Position').setValue([d.grid.cellW + d.grid.gap, 0]);
        try {
          rt1.property('ADBE Vector Repeater Position').expression = lib + '[' + d.grid.cellW + ' + ' + gapRef + ', 0]';
        } catch (e2) {}
        var rep2 = gg.addProperty('ADBE Vector Filter - Repeater');
        rep2.property('ADBE Vector Repeater Copies').setValue(d.grid.rows);
        var rt2 = rep2.property('ADBE Vector Repeater Transform');
        rt2.property('ADBE Vector Repeater Position').setValue([0, d.grid.cellH + d.grid.gap]);
        try {
          rt2.property('ADBE Vector Repeater Position').expression = lib + '[0, ' + d.grid.cellH + ' + ' + gapRef + ']';
        } catch (e3) {}
      }
      var gt = grp.property('ADBE Vector Transform Group');
      gt.property('ADBE Vector Position').setValue([0, 0]);
      try {
        gt.property('ADBE Vector Position').expression = lib + posExprBody;
      } catch (e4) {}
      return grp;
    }
    // the base grid: copy (0,0) sits at cell (0,0)'s center
    addCellGroup(
      'cells',
      d.grid.cellW,
      d.grid.cellH,
      'var g = ' + gapRef + ';\n[-(' + ((d.grid.cols - 1) / 2) + ') * (' + d.grid.cellW + ' + g), -(' + ((d.grid.rows - 1) / 2) + ') * (' + d.grid.cellH + ' + g)]',
      true
    );
    // hero outlines (block frames around 2x2 monitors)
    for (var i = 0; i < d.screens.length; i++) {
      var sc = d.screens[i];
      if (num(sc.span, 1) < 2) continue;
      var hw = d.grid.cellW * sc.span + d.grid.gap * (sc.span - 1);
      var hh = d.grid.cellH * sc.span + d.grid.gap * (sc.span - 1);
      var rowF = sc.row + (sc.span - 1) / 2;
      var colF = sc.col + (sc.span - 1) / 2;
      addCellGroup(
        'hero ' + (i + 1),
        hw,
        hh,
        'var g = ' + gapRef + ';\n[(' + colF + ' - ' + ((d.grid.cols - 1) / 2) + ') * (' + d.grid.cellW + ' + g), (' + rowF + ' - ' + ((d.grid.rows - 1) / 2) + ') * (' + d.grid.cellH + ' + g)]',
        false
      );
    }
    st.bordersLayer = l;
  }

  /** CRT scanlines: a black wall-sized solid with Venetian Blinds, opacity on a live slider. */
  function buildScanlines() {
    var d = st.data;
    if (!d.scanlines) return;
    var w = Math.max(4, Math.round(d.grid.wallW));
    var h = Math.max(4, Math.round(d.grid.wallH));
    var l = st.main.layers.addSolid([0, 0, 0], 'Scanlines', w, h, 1, st.main.duration);
    l.comment = TAG + '-scanlines';
    try {
      l.source.parentFolder = st.root;
      l.source.comment = TAG + '-solid';
    } catch (e) {}
    l.parent = st.ctl;
    tf(l).property('ADBE Position').setValue([0, 0]);
    try {
      var fx = l.property('ADBE Effect Parade').addProperty('ADBE Venetian Blinds');
      fx.property('Transition Completion').setValue(50);
      fx.property('Direction').setValue(0);
      fx.property('Width').setValue(3);
    } catch (e2) {}
    tf(l).property('ADBE Opacity').expression = exprLib() + 'C(' + q('Scanlines (%)') + ', ' + num(d.scanlines.strength, 25) + ')';
    st.scanLayer = l;
  }

  // ---------------------------------------------------------------- build flow

  function findRoot(buildKey) {
    var items = app.project.items;
    for (var i = 1; i <= items.length; i++) {
      var it = items[i];
      if (it instanceof FolderItem && typeof it.comment === 'string' && it.comment === TAG + '-root ' + buildKey) return it;
    }
    return null;
  }

  function begin(json) {
    var a = args(json);
    var data = J.parse(readFile(a.jsonPath));
    if (!data || data.version !== 1) throw new Error('Unexpected wall data');
    if (!app.project) app.newProject();
    app.beginUndoGroup('Wallmaker: build (prepare)');
    try {
      st = {
        data: data,
        folder: String(a.folder || ''),
        i: 0,
        built: 0,
        skipped: [],
        footage: {},
        root: null,
        footFolder: null,
        main: null,
        ctl: null,
        bgLayer: null,
        staticLayer: null,
        labelTpl: null,
        bordersLayer: null,
        scanLayer: null,
        focusNull: null,
        padWidth: String(data.screens.length).length > 2 ? String(data.screens.length).length : 2
      };
      var root = findRoot(data.buildKey);
      if (!root) {
        root = app.project.items.addFolder('Wallmaker \u00b7 ' + data.compName);
        root.comment = TAG + '-root ' + data.buildKey;
      }
      st.root = root;
      for (var i = root.numItems; i >= 1; i--) {
        var it = root.item(i);
        if (it instanceof FolderItem && it.comment === TAG + '-videos') st.footFolder = it;
        else if (it instanceof CompItem && it.comment === TAG + '-staticcomp') removeItemDeep(it);
      }
      if (!st.footFolder) {
        st.footFolder = app.project.items.addFolder('videos');
        st.footFolder.comment = TAG + '-videos';
        st.footFolder.parentFolder = root;
      }
      indexExistingFootage();

      // the main comp: reuse the item on a rebuild (it stays valid wherever it is already used,
      // even if the user moved it out of our folder) -- found by its tagged comment, not its name
      var main = null;
      var itemsAll = app.project.items;
      for (var j = 1; j <= itemsAll.length; j++) {
        var c = itemsAll[j];
        if (c instanceof CompItem && c.comment === TAG + '-comp ' + data.buildKey) {
          main = c;
          break;
        }
      }
      if (!main) {
        var clash = findCompByName(data.compName);
        if (clash && !isOurs(clash)) throw new Error('A comp named "' + data.compName + '" already exists in this project (not built by Wallmaker). Pick another comp name.');
      }
      var dur = Math.max(1 / data.fps, data.durationSec);
      if (!main) {
        main = app.project.items.addComp(data.compName, data.frame.w, data.frame.h, 1, dur, data.fps);
        main.comment = TAG + '-comp ' + data.buildKey;
        main.parentFolder = root;
      } else {
        main.name = data.compName;
        main.width = data.frame.w;
        main.height = data.frame.h;
        main.duration = dur;
        main.frameRate = data.fps;
        // wipe our previous layers; keep the controls null (its values/keyframes) and any user-added layers
        for (var k = main.numLayers; k >= 1; k--) {
          var l = main.layer(k);
          if (isOurs(l) && l.comment.indexOf(TAG + '-controls') !== 0 && l.comment.indexOf(TAG + '-focus') !== 0) l.remove();
        }
      }
      main.bgColor = [data.bg.color[0], data.bg.color[1], data.bg.color[2]];
      st.main = main;
      st.ctl = ensureControls(main);
      st.focusNull = ensureFocusNull(main);
      buildBackground();
      buildBorders();
      return reply({ total: data.screens.length });
    } finally {
      app.endUndoGroup();
    }
  }

  function step(json) {
    if (!st) throw new Error('begin() was not called');
    var a = args(json);
    var count = Math.max(1, num(a.count, 20));
    app.beginUndoGroup('Wallmaker: build (screens)');
    try {
      var end = Math.min(st.data.screens.length, st.i + count);
      while (st.i < end) {
        buildScreen(st.i);
        st.i++;
      }
      return reply({ done: st.i, total: st.data.screens.length });
    } finally {
      app.endUndoGroup();
    }
  }

  function finish() {
    if (!st || !st.main) {
      st = null;
      return reply({ compName: '', screens: 0, videos: 0, skipped: [] });
    }
    app.beginUndoGroup('Wallmaker: build (finish)');
    try {
      var d = st.data;
      if (st.labelTpl) st.labelTpl.remove();
      buildScanlines();
      // bottom to top: Background, Static, Borders, screens & labels, Scanlines, Focus, Controls
      if (st.bordersLayer) st.bordersLayer.moveToEnd();
      if (st.staticLayer) st.staticLayer.moveToEnd();
      if (st.bgLayer) st.bgLayer.moveToEnd();
      if (st.scanLayer) st.scanLayer.moveToBeginning();
      if (st.focusNull) st.focusNull.moveToBeginning();
      if (!st.data.focus) {
        // the feature was switched off on a rebuild: drop the stale focus null
        for (var fi = st.main.numLayers; fi >= 1; fi--) {
          var fl = st.main.layer(fi);
          if (isOurs(fl) && fl.comment.indexOf(TAG + '-focus') === 0) fl.remove();
        }
      }
      if (st.ctl) st.ctl.moveToBeginning();
      // drop footage that no build uses any more (e.g. a rebuild with a different set of videos)
      if (st.footFolder) {
        for (var i = st.footFolder.numItems; i >= 1; i--) {
          var it = st.footFolder.item(i);
          try {
            if (it instanceof FootageItem && it.usedIn.length === 0) it.remove();
          } catch (e) {}
        }
      }
      // and our solids that a rebuild orphaned (old Background / Scanlines / noise sources)
      if (st.root) {
        for (var si = st.root.numItems; si >= 1; si--) {
          var sit = st.root.item(si);
          try {
            if (sit instanceof FootageItem && sit.comment === TAG + '-solid' && sit.usedIn.length === 0) sit.remove();
          } catch (e3) {}
        }
      }
      var videos = 0;
      for (var k in st.footage) if (st.footage.hasOwnProperty(k)) videos++;
      try {
        st.main.openInViewer();
      } catch (e2) {}
      var out = { compName: st.main.name, screens: st.built, videos: videos, skipped: st.skipped };
      st = null;
      return reply(out);
    } finally {
      app.endUndoGroup();
    }
  }

  function removeBuild(json) {
    var a = args(json);
    app.beginUndoGroup('Wallmaker: remove build');
    try {
      var root = findRoot(String(a.buildKey || ''));
      if (!root) return reply({ removed: false });
      removeItemDeep(root);
      return reply({ removed: true });
    } finally {
      app.endUndoGroup();
    }
  }

  // ---------------------------------------------------------------- info / testing

  /** What's selected in the Project panel, as wall sources: video files + comps (never our own builds). */
  function selectedSources() {
    var files = [];
    var comps = [];
    var sel = app.project.selection;
    for (var i = 0; i < sel.length; i++) {
      var it = sel[i];
      if (it instanceof CompItem) {
        if (!isOurs(it)) comps.push({ id: it.id, name: it.name });
      } else if (it instanceof FootageItem && it.mainSource && it.mainSource.file && !it.footageMissing && it.hasVideo) {
        files.push(it.mainSource.file.fsName.replace(/\\/g, '/'));
      }
    }
    return reply({ files: files, comps: comps });
  }

  function info() {
    var f = app.project ? app.project.file : null;
    return reply({
      version: VERSION,
      ae: String(app.version),
      aeMajor: aeVersion(),
      projectPath: f ? f.fsName : '',
      projectDir: f ? f.parent.fsName : '',
      projectName: f ? decodeURI(f.name).replace(/\.aep$/i, '') : '',
      scriptFileAccess: (function () {
        try {
          return app.preferences.getPrefAsLong('Main Pref Section', 'Pref_SCRIPTING_FILE_NETWORK_SECURITY') === 1;
        } catch (e) {
          return null;
        }
      })()
    });
  }

  function snapshot(json) {
    var a = args(json);
    var comp = findCompByName(String(a.compName));
    if (!comp) throw new Error('Comp not found: ' + a.compName);
    if (typeof comp.saveFrameToPng !== 'function') throw new Error('saveFrameToPng not available in this version');
    comp.saveFrameToPng(num(a.time, 0), new File(a.path));
    return reply({ ok: true });
  }

  /** Evaluated (post-expression) state of every screen layer at a time -- the automated tests assert on this. */
  function probe(json) {
    var a = args(json);
    var comp = findCompByName(String(a.compName));
    if (!comp) throw new Error('Comp not found: ' + a.compName);
    var t = num(a.time, 0);
    var out = [];
    for (var i = 1; i <= comp.numLayers; i++) {
      var l = comp.layer(i);
      if (typeof l.comment !== 'string' || l.comment.indexOf(TAG + '-screen') !== 0) continue;
      var g = tf(l);
      out.push({
        name: l.name,
        idx: parseInt(l.comment.substring((TAG + '-screen ').length), 10),
        opacity: g.property('ADBE Opacity').valueAtTime(t, false),
        pos: g.property('ADBE Position').valueAtTime(t, false),
        scale: g.property('ADBE Scale').valueAtTime(t, false)
      });
    }
    return reply(out);
  }

  return { info: info, begin: begin, step: step, finish: finish, remove: removeBuild, selectedSources: selectedSources, snapshot: snapshot, probe: probe, version: VERSION };
})();
