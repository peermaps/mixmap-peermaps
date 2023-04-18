var prepare = require('mixmap-georender/prepare')
var shaders = require('mixmap-georender')
var geotext = require('mixmap-georender/text')
var planner = require('viewbox-query-planner')
var getImagePixels = require('get-image-pixels')
var bboxIntersect = require('bbox-intersect')
var work = require('webworkify')
var storageHooks = require('./lib/storage-hooks.js')
var Features = require('./lib/features.js')
var queryWorker = require('./lib/query-worker')
var workerBundle = require('./lib/browserify-worker-bundler')

module.exports = P
function P(opts) {
  var self = this
  if (!(self instanceof P)) return new P(opts)
  self._map = opts.map
  self._map.on('resize', function () {
    self._scheduleRecalc()
  })
  self._features = new Features()
  self._queryWorker = work(queryWorker)
  self._queryWorker.onmessage = function (e) {
    var {type} = e.data
    if (type === 'query:result') {
      var {queryIndex, rowCount, result} = e.data
      self._queryOpen[queryIndex] = null
      self._features.decoder.emit('decode', {
        queryIndex,
        rowCount,
        buffer: Buffer.from(result[1]),
      })
    }
    if (type === 'query:done') {
      self._decodedCache = null
    }
  }
  self._features.decoder.on('decoded', function (row) {
    self._features.addBufferDecoded(row)
    self._scheduleRecalc()
  })
  self._queryWorker.postMessage({
    type: 'init:bundles',
    eyros: workerBundle(opts.eyros, 'eyros'),
    storage: workerBundle(opts.storage, 'storage'),
    storageOptions: opts.storageOptions,
    wasmSourceUrl: opts.wasmSourceUrl,
  })

  self._stylePixels = null
  self._styleTexture = null
  self._styleQueue = null
  if (!opts.style) {
    throw new Error('opts.style must be an Image or { width, height, data } object')
  } else if (opts.style.data) { // pass through data directly
    self._stylePixels = opts.style.data
    self._styleTexture = self._map.regl.texture(opts.style)
  } else if (opts.style.complete) { // img loaded
    self._stylePixels = getImagePixels(opts.style),
    self._styleTexture = self._map.regl.texture(opts.style)
  } else if (opts.style.addEventListener) {
    self._styleQueue = []
    opts.style.addEventListener('load', function (ev) {
      self._stylePixels = getImagePixels(opts.style),
      self._styleTexture = self._map.regl.texture(opts.style)
      for (var i = 0; i < self._styleQueue.length; i++) {
        self._styleQueue[i]()
      }
      self._styleQueue = null
    })
  } else {
    throw new Error('unexpected opts.style value. expected Image or { width, height, data } object')
  }
  var geoRender = shaders(self._map)
  self._geoRender = geoRender
  self.draw = {
    area: self._map.createDraw(geoRender.areas),
    areaT: self._map.createDraw(geoRender.areas),
    areaBorder: self._map.createDraw(geoRender.areaBorders),
    areaBorderT: self._map.createDraw(geoRender.areaBorders),
    lineStroke: self._map.createDraw(geoRender.lineStroke),
    lineStrokeT: self._map.createDraw(geoRender.lineStroke),
    lineFill: self._map.createDraw(geoRender.lineFill),
    lineFillT: self._map.createDraw(geoRender.lineFill),
    point: self._map.createDraw(geoRender.points),
    pointT: self._map.createDraw(geoRender.points),
    label: {},
  }
  self._zoom = -1
  self._geodata = null
  self._props = null
  self._geotext = null
  self._font = opts.font
  self._getFont(function (err, font) {
    if (font) {
      self._geotext = geotext({ font })
      self._scheduleRecalc()
    }
  })
  self._plan = planner()
  self._queryResults = []
  self._lastQueryIndex = -1
  self._queryCanceled = {}
  self._queryOpen = {}
  self._recalcTimer = null
  self._recalcTime = 0
  self.props = {}
  self.layer = self._map.addLayer({
    viewbox: function (bbox, zoom, cb) {
      self._onviewbox(bbox,zoom,cb)
    }
  })

  // for debugging purposes, safe to remove
  self._debug = opts.debug ? console.log : noop
  self._recalcTotalTime = 0
  self._recalcCount = 0
}

P.prototype._error = function (err) {
  console.error('CAUGHT', err)
}

P.prototype.setStorage = function (opts) {
  this._queryWorker.postMessage({
    type: 'init:setStorage',
    storage: opts.storage ? workerBundle(opts.storage) : null,
    storageOptions: opts.storageOptions,
  })
}

P.prototype._onviewbox = function (bbox, zoom, cb) {
  var self = this
  var boxes = self._plan.update(bbox)
  for (var i = 0; i < boxes.length; i++) {
    self._plan.add(boxes[i])
  }
  self._zoom = zoom
  boxes.forEach(function (bbox) {
    var queryIndex = ++self._lastQueryIndex
    self._queryOpen[queryIndex] = true
    self._queryResults.push({ bbox, queryIndex })
    self._queryWorker.postMessage({
      type: 'query:init',
      bbox,
      queryIndex,
    })
  })
  cb()
}

P.prototype._getStyle = function (cb) {
  if (this._stylePixels && this._styleTexture) {
    cb(this._stylePixels, this._styleTexture)
  } else {
    if (!this._styleQueue) this._styleQueue = []
    this._styleQueue.push(cb)
  }
}

P.prototype._cull = function () {
  var self = this
  var culling = 0
  for (var i = 0; i < self._queryResults.length; i++) {
    var qr = self._queryResults[i]
    if (qr === null) continue
    if (!bboxIntersect(self._map.viewbox, qr.bbox)) {
      culling++
      if (self._queryOpen[qr.queryIndex]) {
        self._queryCanceled[qr.queryIndex] = true
        delete self._queryOpen[qr.queryIndex]
        self._queryWorker.emit({
          type: 'query:cancel',
          queryIndex: qr.queryIndex,
          currentMapViewbox: self._map.viewbox,
        })
      }
      self._plan.subtract(qr.bbox)
      self._queryResults[i] = null
      self._features.cull(i)
    }
  }
}

P.prototype._scheduleRecalc = function () {
  var self = this
  if (self._recalcTimer) return
  var interval = Math.min(2000, 200 + this._recalcTime)
  self._debug('_scheduleRecalc interval', interval)
  self._recalcTimer = setTimeout(function () {
    self._debug('_scheduleRecalc calling _recalc()')
    self._recalc(true)
    self._recalcTimer = null
  }, interval)
}

P.prototype._recalc = function(fromScheduled) {
  var self = this
  if (!fromScheduled && !self._recalcTimer) {
    self._debug('something is calling _recalc() directly and nothing is scheduled')
  } else if (!fromScheduled && self._recalcTimer) {
    self._debug('something is calling _recalc() directly while already scheduled')
    return
  }
  self._getStyle(function (stylePixels, styleTexture) {
    self._debug('- BEGIN _recalc() #', ++self._recalcCount)
    var start = performance.now()
    // todo: compare all-in-one props against pushing more props
    self._cull()
    var zoom = Math.round(self._map.getZoom())
    var prepTime = performance.now()
    self._geodata = prepare({
      stylePixels: self._stylePixels,
      styleTexture: self._styleTexture,
      decoded: self._features.getDecoded(),
    })
    self._debug('-- PERF time prep', performance.now() - prepTime, 'ms')
    var propsTime = performance.now()
    var props = self._geodata.update(zoom)
    setProps(self.draw.point.props, props.pointP)
    setProps(self.draw.lineFill.props, props.lineP)
    setProps(self.draw.lineStroke.props, props.lineP)
    setProps(self.draw.area.props, props.areaP)
    setProps(self.draw.areaBorder.props, props.areaBorderP)
    setProps(self.draw.pointT.props, props.pointT)
    setProps(self.draw.lineFillT.props, props.lineT)
    setProps(self.draw.lineStrokeT.props, props.lineT)
    setProps(self.draw.areaT.props, props.areaT)
    setProps(self.draw.areaBorderT.props, props.areaBorderT)
    self._debug('-- PERF time props', performance.now() - propsTime, 'ms')
    var geoTextTime = performance.now()
    if (self._geotext) {
      var textProps = self._geotext.update(props, self._map)
      var ns = Object.keys(textProps)
      for (var i = 0; i < ns.length; i++) {
        var n = ns[i]
        if (!self.draw.label[n]) {
          self.draw.label[n] = self._map.createDraw(self._geoRender.labels(n))
        }
        setProps(self.draw.label[n].props, textProps[n])
      }
    }
    self._debug('-- PERF time geo text', performance.now() - geoTextTime, 'ms')
    self._map.draw()
    self._recalcTime = performance.now() - start
    self._debug('-- PERF time _recalc()', self._recalcTime, 'ms')
    self._recalcTotalTime += self._recalcTime
    self._debug('-- PERF acc time _recalc()', self._recalcTotalTime, 'ms')
    self._debug('- END _recalc()')
  })
}

function setProps(dst, src) {
  if (dst.length === 0) dst.push({})
  Object.assign(dst[0],src)
}

P.prototype._getFont = function (cb) {
  var self = this
  var r0 = self._font
  if (!r0) return cb(null, null)
  if (typeof self._font === 'function') {
    r0 = self._font(cb)
  }
  if (r0 && typeof r0.then === 'function') {
    r0.then(r1 => {
      if (r1 && typeof r1.arrayBuffer === 'function') {
        var r2 = r1.arrayBuffer()
        if (r2 && typeof r2.then === 'function') {
          r2.then(r3 => cb(null, new Uint8Array(r3))).catch(cb)
        } else {
          cb(null, new Uint8Array(r2))
        }
      } else {
        cb(null, r1)
      }
    }).catch(cb)
  } else {
    cb(null, r0)
  }
}

P.prototype.pick = function (opts, cb) {
  var self = this
  if (!cb) cb = noop
  this._map.pick(opts, function (err, data) {
    if (err) return cb(err)
    if (feq(data[0],0.0)) {
      cb(null, { id: null, type: null })
    } else if (Math.floor(data[2]/2) === 0 && data[2]%2 < 0.9999) {
      if (self.draw.pointT.props.length === 0) {
        cb(null, { id: null, type: null })
      } else {
        cb(null, { id: self.draw.pointT.props[0].indexToId[data[0]], type: data[1] })
      }
    } else if (Math.floor(data[2]/2) === 0) {
      if (self.draw.point.props.length === 0) {
        cb(null, { id: null, type: null })
      } else {
        cb(null, { id: self.draw.point.props[0].indexToId[data[0]], type: data[1] })
      }
    } else if (Math.floor(data[2]/2) === 1 && data[2]%2 < 0.9999) {
      if (self.draw.lineFillT.props.length === 0) {
        cb(null, { id: null, type: null })
      } else {
        cb(null, { id: self.draw.lineFillT.props[0].indexToId[data[0]], type: data[1] })
      }
    } else if (Math.floor(data[2]/2) === 1) {
      if (self.draw.lineFill.props.length === 0) {
        cb(null, { id: null, type: null })
      } else {
        cb(null, { id: self.draw.lineFill.props[0].indexToId[data[0]], type: data[1] })
      }
    } else if (Math.floor(data[2]/2) === 2 && data[2]%2 < 0.9999) {
      if (self.draw.area.props.length === 0) {
        cb(null, { id: null, type: null })
      } else {
        cb(null, { id: self.draw.area.props[0].indexToId[data[0]], type: data[1] })
      }
    } else if (Math.floor(data[2]/2) === 2) {
      if (self.draw.area.props.length === 0) {
        cb(null, { id: null, type: null })
      } else {
        cb(null, { id: self.draw.area.props[0].indexToId[data[0]], type: data[1] })
      }
    } else {
      cb(null, { id: null, type: null })
    }
  })
}

function feq(a,b,epsilon) {
  return Math.abs(a-b) < (epsilon === undefined ? 1e-6 : epsilon)
}
function noop() {}
