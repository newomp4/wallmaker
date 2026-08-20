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
  var CTL = 'Wallmaker Controls'; // the wall null: every screen is parented to it, its sliders drive the expressions
  var CAM = 'Wallmaker Camera'; // the wall null's parent: one keyframed 'Zoom to screen (%)' slider drives the move
  var REC_V = 2; // rebuild-record version (v1 = camera keyframes lived on the Controls null)
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
      '  catch (e) { try { var n = thisLayer; while (n.hasParent) { n = n.parent; } v = n.effect(nm)(1).value; } catch (e2) {} }\n' +
      '  return v;\n' +
      '}\n'
    );
  }

  /** Accessor for the camera null's OWN effects (same shape as C, but reads this layer). */
  function camLib() {
    return (
      'function E(nm, df) {\n' +
      '  var v = df;\n' +
      '  try { v = thisLayer.effect(nm)(1).value; } catch (e) {}\n' +
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
    var pop = st.data.reveal.style === 'pop' && !screen.featured;
    var body = exprLib() + 'var m = C(' + q('Screen scale (%)') + ', 100) / 100;\nvar e = 1;\n';
    if (pop) {
      body +=
        turnOnSnippet(screen.th) +
        'if (dt < 0) { e = 0; } else { var c1 = 1.70158; var c3 = c1 + 1; e = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); if (e < 0) e = 0; }\n';
    }
    body += '[' + bsx + ' * m * e, ' + bsy + ' * m * e]';
    return body;
  }

  function opacityExpr(screen) {
    var r = st.data.reveal;
    if (screen.featured) {
      // the centered screen means PINNED: only the master opacity slider applies
      return exprLib() + 'C(' + q('Screens opacity (%)') + ', 100)';
    }
    var body =
      exprLib() +
      turnOnSnippet(screen.th) +
      'var OP = C(' + q('Screens opacity (%)') + ', 100);\n' +
      'var dead = (' + screen.dead + ' * 100 < C(' + q('Dead screens (%)') + ', ' + num(r.deadPct, 0) + '));\n' +
      'var on = 0;\n' +
      'if (!dead && dt >= 0) {\n';
    if (r.style === 'fade') {
      body += '  on = p;\n';
    } else if (r.style === 'flicker') {
      // a tube warming up: on/off per frame, settling as p approaches 1
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
    body += 'on * OP';
    return body;
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

  // ---------------------------------------------------------------- the rig (two nulls)

  /**
   * THE REBUILD CONTRACT. Both rig nulls carry a JSON record after '|' in their comment that
   * remembers every value WE last wrote (sliders, point controls, and the camera's keyframes).
   * On a rebuild: anything the user never touched (no keyframes, value still equal to our record)
   * FOLLOWS the panel; anything they changed, keyframed or re-eased is theirs and is left alone.
   * Switched-off features get their controls removed so stale values can't leak into expressions.
   */
  function recOf(layer) {
    var c = String(layer.comment || '');
    var i = c.indexOf('|');
    if (i < 0) return {};
    var rec = null;
    try {
      rec = J.parse(c.substring(i + 1));
    } catch (e) {}
    return rec || {};
  }
  function setRec(layer, rec) {
    var c = String(layer.comment || '');
    var i = c.indexOf('|');
    var base = i < 0 ? c : c.substring(0, i);
    layer.comment = base + '|' + J.stringify(rec);
  }

  function addSlider(fx, name, val, rec) {
    for (var i = 1; i <= fx.numProperties; i++) {
      if (fx.property(i).name === name) {
        var prop = fx.property(i).property(1);
        var prev = rec[name];
        var untouched = prop.numKeys === 0 && typeof prev === 'number' && Math.abs(prop.value - prev) < 0.005;
        if (untouched) {
          try {
            prop.setValue(val);
            rec[name] = val;
          } catch (eU) {}
        }
        return fx.property(i);
      }
    }
    var e = fx.addProperty('ADBE Slider Control');
    e.name = name;
    e.property(1).setValue(val);
    rec[name] = val;
    return e;
  }

  /** Same contract, for a 2D Point Control (the camera's manual pan). */
  function addPoint(fx, name, val, rec) {
    for (var i = 1; i <= fx.numProperties; i++) {
      if (fx.property(i).name === name) {
        var prop = fx.property(i).property(1);
        var prev = rec[name];
        var untouched =
          prop.numKeys === 0 && prev instanceof Array && Math.abs(prop.value[0] - prev[0]) < 0.005 && Math.abs(prop.value[1] - prev[1]) < 0.005;
        if (untouched) {
          try {
            prop.setValue(val);
            rec[name] = [val[0], val[1]];
          } catch (eU2) {}
        }
        return fx.property(i);
      }
    }
    var e = fx.addProperty('ADBE Point Control');
    e.name = name;
    e.property(1).setValue(val);
    rec[name] = [val[0], val[1]];
    return e;
  }

  function removeSlider(fx, name, rec) {
    for (var i = fx.numProperties; i >= 1; i--) {
      if (fx.property(i).name === name) {
        try {
          fx.property(i).remove();
        } catch (eR) {}
      }
    }
    delete rec[name];
  }

  function findTagged(comp, suffix) {
    for (var i = 1; i <= comp.numLayers; i++) {
      var l = comp.layer(i);
      if (isOurs(l) && l.comment.indexOf(TAG + '-' + suffix) === 0) return l;
    }
    return null;
  }

  /**
   * The camera null: the wall's parent. Its Position and Scale are expressions reading its own
   * controls, so the WHOLE move is one keyframable number ('Zoom to screen (%)': 0 = the whole
   * wall, 100 = the target screen filling the comp). Retime it, re-ease it in the graph editor or
   * replace the keys entirely -- the geometry follows, and a rebuild will not touch your keys.
   */
  function ensureCamera(comp) {
    var d = st.data;
    var cam = findTagged(comp, 'camera');
    if (!cam) {
      cam = comp.layers.addNull(comp.duration);
      cam.name = CAM;
      cam.comment = TAG + '-camera';
      tf(cam).property('ADBE Anchor Point').setValue([0, 0]);
    }
    cam.enabled = false;
    cam.shy = false;
    try {
      cam.startTime = 0;
      cam.inPoint = 0;
      cam.outPoint = comp.duration;
    } catch (eSpan) {}
    var rec = recOf(cam);
    st.camRec = rec;
    var plan = d.camera;
    var fx = cam.property('ADBE Effect Parade');
    addSlider(fx, 'Zoom to screen (%)', 0, rec);
    addSlider(fx, 'Target column', plan ? plan.cell[0] : 0, rec);
    addSlider(fx, 'Target row', plan ? plan.cell[1] : 0, rec);
    addSlider(fx, 'Extra scale (%)', 100, rec);
    addPoint(fx, 'Pan (px)', [0, 0], rec);
    // the two expressions. They read live values, so changing Gap or panning stays correct.
    var W = d.frame.w;
    var H = d.frame.h;
    var g = d.grid;
    var full = plan ? plan.scale : 100;
    var lib = exprLib() + camLib();
    var common =
      'var Z = E(' + q('Zoom to screen (%)') + ', 0) / 100;\n' +
      'var X = E(' + q('Extra scale (%)') + ', 100) / 100;\n';
    var posBody =
      lib +
      common +
      'var gap = C(' + q('Gap (px)') + ', ' + num(g.gap, 0) + ');\n' +
      'var cc = E(' + q('Target column') + ', ' + (plan ? plan.cell[0] : 0) + ');\n' +
      'var cr = E(' + q('Target row') + ', ' + (plan ? plan.cell[1] : 0) + ');\n' +
      'var px = (cc - ' + ((g.cols - 1) / 2) + ') * (' + g.cellW + ' + gap);\n' +
      'var py = (cr - ' + ((g.rows - 1) / 2) + ') * (' + g.cellH + ' + gap);\n' +
      'var k = ' + full + ' / 100;\n' +
      'var pan = E(' + q('Pan (px)') + ', [0, 0]);\n' +
      '[' + W / 2 + ' + pan[0] - X * Z * k * px, ' + H / 2 + ' + pan[1] - X * Z * k * py]';
    var sclBody = lib + common + 'var s = (100 + Z * (' + full + ' - 100)) * X;\n[s, s]';
    var pp = tf(cam).property('ADBE Position');
    var sp = tf(cam).property('ADBE Scale');
    try {
      if (pp.numKeys === 0) pp.setValue([W / 2, H / 2]);
      pp.expression = posBody;
      if (sp.numKeys === 0) sp.setValue([100, 100]);
      sp.expression = sclBody;
    } catch (eX) {}
    return cam;
  }

  /**
   * Write the intro / outro move as keyframes on 'Zoom to screen (%)'. The record remembers the
   * exact keys (time, value AND easing) we wrote: if they still look like ours we replace them,
   * and if you have touched anything about them they are yours and we leave them completely alone.
   */
  function applyCamera(cam) {
    var d = st.data;
    var plan = d.camera;
    var rec = st.camRec || {};
    var fx = cam.property('ADBE Effect Parade');
    var zp = null;
    for (var i = 1; i <= fx.numProperties; i++) if (fx.property(i).name === 'Zoom to screen (%)') zp = fx.property(i).property(1);
    if (!zp) return;
    if (!keysAreOurs(zp, rec.__keys)) {
      st.keptCamKeys = true;
      return; // hand-edited: not ours to rewrite
    }
    try {
      while (zp.numKeys > 0) zp.removeKey(1);
    } catch (eC) {}
    var keys = [];
    if (plan && plan.intro) {
      if (plan.intro.hold > 0) keys.push([0, 100]);
      keys.push([plan.intro.hold, 100]);
      keys.push([plan.intro.end, 0]);
    }
    if (plan && plan.outro) {
      keys.push([plan.outro.start, 0]);
      keys.push([plan.outro.end, 100]);
    }
    for (var k = 0; k < keys.length; k++) {
      try {
        zp.setValueAtTime(keys[k][0], keys[k][1]);
      } catch (eK) {}
    }
    var ease = new KeyframeEase(0, EASE_INFLUENCE);
    for (var m = 1; m <= zp.numKeys; m++) {
      try {
        zp.setInterpolationTypeAtKey(m, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
        zp.setTemporalEaseAtKey(m, [ease], [ease]);
      } catch (eE) {}
    }
    rec.__keys = keys;
    if (zp.numKeys === 0) delete rec.__keys;
  }

  var EASE_INFLUENCE = 75;

  /** Do this property's keyframes still match, exactly, what we last wrote (times, values, easing)? */
  function keysAreOurs(prop, want) {
    if (!want || !want.length) return prop.numKeys === 0;
    if (prop.numKeys !== want.length) return false;
    for (var i = 1; i <= prop.numKeys; i++) {
      if (Math.abs(prop.keyTime(i) - want[i - 1][0]) > 0.002) return false;
      if (Math.abs(prop.keyValue(i) - want[i - 1][1]) > 0.01) return false;
      try {
        var ein = prop.keyInTemporalEase(i)[0];
        var eout = prop.keyOutTemporalEase(i)[0];
        if (Math.abs(ein.influence - EASE_INFLUENCE) > 1 || Math.abs(eout.influence - EASE_INFLUENCE) > 1) return false;
        if (Math.abs(ein.speed) > 0.01 || Math.abs(eout.speed) > 0.01) return false;
      } catch (eT) {}
    }
    return true;
  }

  /** The wall null: every screen hangs off it, and it hangs off the camera. Sliders drive the expressions. */
  function ensureControls(comp) {
    var d = st.data;
    var ctl = findTagged(comp, 'controls');
    if (!ctl) {
      ctl = comp.layers.addNull(comp.duration);
      ctl.name = CTL;
      ctl.comment = TAG + '-controls';
      tf(ctl).property('ADBE Anchor Point').setValue([0, 0]);
    }
    ctl.enabled = false;
    ctl.shy = false;
    try {
      ctl.startTime = 0;
      ctl.inPoint = 0;
      ctl.outPoint = comp.duration; // a kept null must span a comp that grew on rebuild
    } catch (eSpan) {}
    var rec = recOf(ctl);
    st.ctlRec = rec;
    var posP = tf(ctl).property('ADBE Position');
    var sclP = tf(ctl).property('ADBE Scale');
    var oldRig = num(rec.__v, 1) < 2;
    // Decide ownership BEFORE parenting: assigning a parent makes AE rewrite the child's local
    // transform to preserve its world transform, so afterwards these values mean nothing.
    var offUntouched =
      posP.numKeys === 0 &&
      (oldRig || (typeof rec.__cx === 'number' && Math.abs(posP.value[0] - rec.__cx) < 0.5 && Math.abs(posP.value[1] - rec.__cy) < 0.5));
    var sclUntouched = sclP.numKeys === 0 && (oldRig || Math.abs(sclP.value[0] - 100) < 0.01);
    if (oldRig) {
      // built by an older Wallmaker, where the camera keyframed THIS null: those keys were ours,
      // so clear them -- the camera null owns the move now and the wall sits at its origin.
      try {
        while (posP.numKeys > 0) posP.removeKey(1);
        while (sclP.numKeys > 0) sclP.removeKey(1);
      } catch (eOld) {}
      try {
        var c0 = String(ctl.comment || '');
        var bar = c0.indexOf('|');
        ctl.comment = (bar < 0 ? c0 : c0.substring(0, bar)).replace(' cam', '') + (bar < 0 ? '' : c0.substring(bar));
      } catch (eCm) {}
    }
    try {
      if (ctl.parent !== st.cam) ctl.parent = st.cam;
    } catch (eP) {}
    // ... and write them back AFTER, so AE's parenting compensation cannot survive
    if (sclUntouched) {
      try {
        sclP.setValue([100, 100]);
      } catch (eS) {}
    }
    if (offUntouched) {
      try {
        posP.setValue([0, 0]);
      } catch (ePos) {}
      rec.__cx = 0;
      rec.__cy = 0;
    }
    rec.__v = REC_V;
    var fx = ctl.property('ADBE Effect Parade');
    addSlider(fx, 'Reveal start (s)', num(d.reveal.start, 0), rec);
    addSlider(fx, 'Reveal duration (s)', num(d.reveal.duration, 0), rec);
    addSlider(fx, 'Turn-on (frames)', num(d.reveal.animFrames, 8), rec);
    addSlider(fx, 'Dead screens (%)', num(d.reveal.deadPct, 0), rec);
    addSlider(fx, 'Gap (px)', num(d.grid.gap, 0), rec);
    addSlider(fx, 'Screen scale (%)', 100, rec);
    addSlider(fx, 'Screens opacity (%)', 100, rec);
    // controls that older builds may have left behind
    removeSlider(fx, 'Label opacity (%)', rec);
    removeSlider(fx, 'Static brightness (%)', rec);
    removeSlider(fx, 'Dropouts (%)', rec);
    removeSlider(fx, 'Border (px)', rec);
    removeSlider(fx, 'Scanlines (%)', rec);
    removeSlider(fx, 'Focus radius (px)', rec);
    removeSlider(fx, 'Focus zoom (%)', rec);
    removeSlider(fx, 'Focus dim (%)', rec);
    return ctl;
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
      if (it instanceof FootageItem && it.mainSource && it.mainSource.file && !it.footageMissing) {
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
    var cw = d.grid.cellW;
    var ch = d.grid.cellH;
    var sx, sy;
    if (d.fill === 'stretch') {
      sx = cw / sw;
      sy = ch / sh;
    } else if (d.fill === 'contain') {
      sx = sy = Math.min(cw / sw, ch / sh);
    } else {
      sx = sy = Math.max(cw / sw, ch / sh);
    }
    var layer;
    try {
      layer = st.main.layers.add(it); // can throw on circular comp nesting -- that source is skipped, not the build
    } catch (eAdd) {
      st.skipped.push(vid.name + ' (' + String(eAdd && eAdd.message ? eAdd.message : eAdd) + ')');
      return;
    }
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
    var posP = tf(layer).property('ADBE Position');
    posP.setValue([(s.col - (d.grid.cols - 1) / 2) * (d.grid.cellW + d.grid.gap), (s.row - (d.grid.rows - 1) / 2) * (d.grid.cellH + d.grid.gap)]);
    posP.expression = positionExpr(s.row, s.col);
    var sclP = tf(layer).property('ADBE Scale');
    sclP.setValue([sx * 100, sy * 100]);
    sclP.expression = scaleExpr(sx * 100, sy * 100, s);
    tf(layer).property('ADBE Opacity').expression = opacityExpr(s);
    st.built++;
  }

  // ---------------------------------------------------------------- background

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
        cam: null,
        bgLayer: null,
        ctlRec: null,
        camRec: null,
        keptCamKeys: false,
        padWidth: String(data.screens.length).length > 2 ? String(data.screens.length).length : 2
      };
      // refuse a foreign comp-name clash BEFORE creating anything (no orphan folders on error)
      var preExisting = null;
      var itemsPre = app.project.items;
      for (var pi = 1; pi <= itemsPre.length; pi++) {
        var pc = itemsPre[pi];
        if (pc instanceof CompItem && pc.comment === TAG + '-comp ' + data.buildKey) {
          preExisting = pc;
          break;
        }
      }
      if (!preExisting) {
        var clash0 = findCompByName(data.compName);
        if (clash0 && !isOurs(clash0)) throw new Error('A comp named "' + data.compName + '" already exists in this project (not built by Wallmaker). Pick another comp name.');
      }
      var root = findRoot(data.buildKey);
      if (!root) {
        root = app.project.items.addFolder('Wallmaker \u00b7 ' + data.compName);
        root.comment = TAG + '-root ' + data.buildKey;
      }
      st.root = root;
      for (var i = root.numItems; i >= 1; i--) {
        var it = root.item(i);
        if (it instanceof FolderItem && it.comment === TAG + '-videos') st.footFolder = it;
      }
      if (!st.footFolder) {
        st.footFolder = app.project.items.addFolder('videos');
        st.footFolder.comment = TAG + '-videos';
        st.footFolder.parentFolder = root;
      }
      indexExistingFootage();

      // the main comp: reuse the item on a rebuild (it stays valid wherever it is already used,
      // even if the user moved it out of our folder) -- found by its tagged comment, not its name
      var main = preExisting;
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
        // wipe our previous layers; keep the rig (its values and your keyframes) and any user-added layers
        for (var k = main.numLayers; k >= 1; k--) {
          var l = main.layer(k);
          if (isOurs(l) && l.comment.indexOf(TAG + '-controls') !== 0 && l.comment.indexOf(TAG + '-camera') !== 0) l.remove();
        }
      }
      main.bgColor = [data.bg.color[0], data.bg.color[1], data.bg.color[2]];
      st.main = main;
      st.cam = ensureCamera(main);
      st.ctl = ensureControls(main); // parents itself to the camera
      applyCamera(st.cam);
      setRec(st.cam, st.camRec || {});
      setRec(st.ctl, st.ctlRec || {});
      buildBackground();
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
      // bottom to top: Background, screens, Controls, Camera
      if (st.bgLayer) st.bgLayer.moveToEnd();
      if (st.ctl) st.ctl.moveToBeginning();
      if (st.cam) st.cam.moveToBeginning();
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
      var out = { compName: st.main.name, screens: st.built, videos: videos, skipped: st.skipped, keptCamKeys: !!st.keptCamKeys };
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

  /** Evaluated camera transform + the zoom keyframes at a time (camera verification). */
  function camState(json) {
    var a = args(json);
    var comp = findCompByName(String(a.compName));
    if (!comp) throw new Error('Comp not found: ' + a.compName);
    var cam = findTagged(comp, 'camera');
    var ctl = findTagged(comp, 'controls');
    if (!cam) throw new Error('Camera null not found');
    var t = num(a.time, 0);
    var zp = null;
    var fx = cam.property('ADBE Effect Parade');
    for (var i = 1; i <= fx.numProperties; i++) if (fx.property(i).name === 'Zoom to screen (%)') zp = fx.property(i).property(1);
    var keys = [];
    if (zp) for (var k = 1; k <= zp.numKeys; k++) keys.push([Math.round(zp.keyTime(k) * 1000) / 1000, Math.round(zp.keyValue(k) * 100) / 100]);
    return reply({
      scale: tf(cam).property('ADBE Scale').valueAtTime(t, false),
      pos: tf(cam).property('ADBE Position').valueAtTime(t, false),
      zoom: zp ? zp.valueAtTime(t, false) : null,
      keys: keys,
      ctlPos: ctl ? tf(ctl).property('ADBE Position').valueAtTime(t, false) : null,
      ctlParent: ctl && ctl.parent ? ctl.parent.name : null
    });
  }

  /** Name/comment/enabled of every layer in a comp (structure verification in the tests). */
  function layersInfo(json) {
    var a = args(json);
    var comp = findCompByName(String(a.compName));
    if (!comp) throw new Error('Comp not found: ' + a.compName);
    var out = [];
    for (var i = 1; i <= comp.numLayers; i++) {
      var l = comp.layer(i);
      out.push({ name: l.name, comment: String(l.comment || ''), enabled: l.enabled });
    }
    return reply(out);
  }

  return { info: info, begin: begin, step: step, finish: finish, remove: removeBuild, selectedSources: selectedSources, snapshot: snapshot, probe: probe, camState: camState, layers: layersInfo, version: VERSION };
})();
