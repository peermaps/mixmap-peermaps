var decode = require('georender-pack/decode')
var prepare = require('mixmap-georender/prepare')
var shaders = require('mixmap-georender')
var geotext = require('mixmap-georender/text')
var planner = require('viewbox-query-planner')
var getImagePixels = require('get-image-pixels')
var bboxIntersect = require('bbox-intersect')
var storageHooks = require('./lib/storage-hooks.js')
 
module.exports = P
function P(opts) {
  var self = this
  if (!(self instanceof P)) return new P(opts)
  self._map = opts.map
  self._trace = {}
  self._loading = new Set
  self._storage = storageHooks(opts.storage, {
    beforeLength: function (name) {
      self._loading.add(name)
    },
    afterLength: function (name) {
      self._loading.delete(name)
    },
    beforeRead: function (name) {
      self._loading.add(name)
    },
    afterRead: function (name) {
      self._loading.delete(name)
    },
  })
  self._dbQueue = []
  self._idCount = new Map
  self._bufCounted = new Set
  opts.eyros({ storage: self._storage, wasmSource: opts.wasmSource })
    .then(db => {
      self._db = db
      for (var i = 0; i < self._dbQueue.length; i++) {
        self._dbQueue[i](db)
      }
      self._dbQueue = null
    })
    .catch(err => self._error(err))

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
    label: self._map.createDraw(geoRender.labels),
  }
  self._zoom = -1
  self._geodata = null
  self._props = null
  self._geotext = geotext()
  self._plan = planner()
  self._decoded = []
  self._lastQueryIndex = -1
  self._queryCanceled = {}
  self._queryOpen = {}
  self._recalcTimer = null
  self._recalcTime = 0
  self.props = {}
  self.layer = self._map.addLayer({
    viewbox: function (bbox, zoom, cb) { self._onviewbox(bbox,zoom,cb) }
  })
}

P.prototype._error = function (err) {
  console.error('CAUGHT', err)
}

P.prototype._onviewbox = function (bbox, zoom, cb) {
  var self = this
  var boxes = self._plan.update(bbox)
  for (var i = 0; i < boxes.length; i++) {
    self._plan.add(boxes[i])
  }
  self._zoom = zoom
  self._getDb(function (db) {
    boxes.forEach(bbox => {
      db.query(bbox, { trace })
        .then(q => self._loadQuery(bbox, q))
        .catch(e => self._error(e))
      function trace(tr) {
        self._trace[tr.file] = tr
      }
    })
    self._scheduleRecalc()
  })
}

P.prototype._getDb = function (cb) {
  var self = this
  if (self._db) cb(self._db)
  else self._dbQueue.push(cb)
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
  for (var i = 0; i < self._decoded.length; i++) {
    var d = self._decoded[i]
    if (d === null) continue
    if (!bboxIntersect(self._map.viewbox, d.bbox)) {
      culling++
      if (self._queryOpen[d.index]) {
        self._queryCanceled[d.index] = true
        delete self._queryOpen[d.index]
      }
      self._plan.subtract(d.bbox)
      self._decoded[i] = null
    }
  }
  for (var file of self._loading) {
    var tr = self._trace[file]
    if (!tr) continue
    if (!bboxIntersect(self._map.viewbox, tr.bbox)) {
      self._storage.destroy(file)
    }
  }
  if (culling > 0) {
    self._decodedCache = null
    self._decoded = self._decoded.filter(function (d) { return d !== null })
  }
}

P.prototype._scheduleRecalc = function () {
  var self = this
  if (self._recalcTimer) return
  self._recalcTimer = setTimeout(function () {
    self._recalc()
    self._recalcTimer = null
  }, Math.min(2000, 200 + this._recalcTime))
}

P.prototype._loadQuery = async function loadQuery(bbox, q) {
  var self = this
  var row, decoded = []
  var index = ++self._lastQueryIndex
  self._queryOpen[index] = true
  self._decoded.push({ bbox, decoded, index })
  while (row = await q.next()) {
    if (self._queryCanceled[index]) {
      self._recalc()
      return
    }
    decoded.push(decode([Buffer.from(row[1])]))
    self._decodedCache = null
    self._scheduleRecalc()
  }
  delete self._queryOpen[index]
  self._recalc()
}

P.prototype._recalc = function() {
  var self = this
  self._getStyle(function (stylePixels, styleTexture) {
    var start = performance.now()
    // todo: compare all-in-one props against pushing more props
    self._cull()
    var zoom = Math.round(self._map.getZoom())
    self._geodata = prepare({
      stylePixels: self._stylePixels,
      styleTexture: self._styleTexture,
      decoded: self._getDecoded(),
    })
    var props = self._geodata.update(zoom)
    //setProps(self.draw.point.props, props.pointP)
    //setProps(self.draw.pointT.props, props.pointT)
    setProps(self.draw.lineFill.props, props.lineP)
    setProps(self.draw.lineStroke.props, props.lineP)
    setProps(self.draw.area.props, props.areaP)
    setProps(self.draw.areaBorder.props, props.areaBorderP)
    setProps(self.draw.lineFillT.props, props.lineT)
    setProps(self.draw.lineStrokeT.props, props.lineT)
    setProps(self.draw.areaT.props, props.areaT)
    setProps(self.draw.areaBorderT.props, props.areaBorderT)
    setProps(self.draw.label.props, self._geotext.update(props, self._map))
    self._map.draw()
    self._recalcTime = performance.now() - start
  })
}

P.prototype._getDecoded = function () {
  if (this._decodedCache) return this._decodedCache
  var pointSize = 0, lineSize = 0, areaSize = 0, areaCellSize = 0, areaBorderSize = 0
  for (var i = 0; i < this._decoded.length; i++) {
    var ds = this._decoded[i].decoded
    for (var j = 0; j < ds.length; j++) {
      var d = ds[j]
      pointSize += d.point.ids.length
      lineSize += d.line.ids.length
      areaSize += d.area.ids.length
      areaCellSize += d.area.cells.length
      areaBorderSize += d.areaBorder.ids.length
    }
  }
  var decoded = {
    point: {
      ids: Array(pointSize).fill(0),
      types: new Float32Array(pointSize),
      positions: new Float32Array(pointSize*2),
      labels: {},
    },
    line: {
      ids: Array(lineSize).fill(0),
      types: new Float32Array(lineSize),
      positions: new Float32Array(lineSize*2),
      normals: new Float32Array(lineSize*2),
      labels: {},
    },
    area: {
      ids: Array(areaSize).fill(0),
      types: new Float32Array(areaSize),
      positions: new Float32Array(areaSize*2),
      cells: new Uint32Array(areaCellSize),
      labels: {},
    },
    areaBorder: {
      ids: Array(areaBorderSize).fill(0),
      types: new Float32Array(areaBorderSize),
      positions: new Float32Array(areaBorderSize*2),
      normals: new Float32Array(areaBorderSize*2),
      labels: {},
    },
  }
  var pointOffset = 0, lineOffset = 0, areaOffset = 0, areaCellOffset = 0, areaBorderOffset = 0
  for (var i = 0; i < this._decoded.length; i++) {
    var ds = this._decoded[i].decoded
    for (var j = 0; j < ds.length; j++) {
      var d = ds[j]
      for (var k = 0; k < d.point.ids.length; k++) {
        decoded.point.ids[pointOffset] = d.point.ids[k]
        decoded.point.types[pointOffset] = d.point.types[k]
        decoded.point.positions[pointOffset*2+0] = d.point.positions[k*2+0]
        decoded.point.positions[pointOffset*2+1] = d.point.positions[k*2+1]
        pointOffset++
      }
      Object.assign(decoded.point.labels, d.point.labels)
      for (var k = 0; k < d.line.ids.length; k++) {
        decoded.line.ids[lineOffset] = d.line.ids[k]
        decoded.line.types[lineOffset] = d.line.types[k]
        decoded.line.positions[lineOffset*2+0] = d.line.positions[k*2+0]
        decoded.line.positions[lineOffset*2+1] = d.line.positions[k*2+1]
        decoded.line.normals[lineOffset*2+0] = d.line.normals[k*2+0]
        decoded.line.normals[lineOffset*2+1] = d.line.normals[k*2+1]
        lineOffset++
      }
      Object.assign(decoded.line.labels, d.line.labels)
      for (var k = 0; k < d.area.cells.length; k++) {
        decoded.area.cells[areaCellOffset++] = d.area.cells[k] + areaOffset
      }
      for (var k = 0; k < d.area.ids.length; k++) {
        decoded.area.ids[areaOffset] = d.area.ids[k]
        decoded.area.types[areaOffset] = d.area.types[k]
        decoded.area.positions[areaOffset*2+0] = d.area.positions[k*2+0]
        decoded.area.positions[areaOffset*2+1] = d.area.positions[k*2+1]
        areaOffset++
      }
      Object.assign(decoded.area.labels, d.area.labels)
      for (var k = 0; k < d.areaBorder.ids.length; k++) {
        decoded.areaBorder.ids[areaBorderOffset] = d.areaBorder.ids[k]
        decoded.areaBorder.types[areaBorderOffset] = d.areaBorder.types[k]
        decoded.areaBorder.positions[areaBorderOffset*2+0] = d.areaBorder.positions[k*2+0]
        decoded.areaBorder.positions[areaBorderOffset*2+1] = d.areaBorder.positions[k*2+1]
        decoded.areaBorder.normals[areaBorderOffset*2+0] = d.areaBorder.normals[k*2+0]
        decoded.areaBorder.normals[areaBorderOffset*2+1] = d.areaBorder.normals[k*2+1]
        areaBorderOffset++
      }
      Object.assign(decoded.areaBorder.labels, d.areaBorder.labels)
    }
  }
  this._decodedCache = decoded
  return decoded
}

function setProps(dst, src) {
  if (dst.length === 0) dst.push({})
  Object.assign(dst[0],src)
}

P.prototype.pick = function (opts, cb) {
  var self = this
  if (!cb) cb = noop
  this._map.pick(opts, function (err, data) {
    if (err) return cb(err)
    if (feq(data[0],0.0)) {
      cb(null, { id: null, type: null })
    } else if (Math.floor(data[2]/2) === 0 && data[2]%2 < 0.9999) {
      cb(null, { id: self.draw.pointT.props[0].indexToId[data[0]], type: data[1] })
    } else if (Math.floor(data[2]/2) === 0) {
      cb(null, { id: self.draw.point.props[0].indexToId[data[0]], type: data[1] })
    } else if (Math.floor(data[2]/2) === 1 && data[2]%2 < 0.9999) {
      cb(null, { id: self.draw.lineFillT.props[0].indexToId[data[0]], type: data[1] })
    } else if (Math.floor(data[2]/2) === 1) {
      cb(null, { id: self.draw.lineFill.props[0].indexToId[data[0]], type: data[1] })
    } else if (Math.floor(data[2]/2) === 2 && data[2]%2 < 0.9999) {
      //cb(null, { id: self.draw.areaT.props[0].indexToId[data[0]], type: data[1] })
      cb(null, { id: self.draw.area.props[0].indexToId[data[0]], type: data[1] })
    } else if (Math.floor(data[2]/2) === 2) {
      cb(null, { id: self.draw.area.props[0].indexToId[data[0]], type: data[1] })
    } else {
      cb(null, { id: null, type: null })
    }
  })
}

function feq(a,b,epsilon) {
  return Math.abs(a-b) < (epsilon === undefined ? 1e-6 : epsilon)
}
function noop() {}
