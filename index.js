var decode = require('georender-pack/decode')
var prepare = require('mixmap-georender/prepare')
var shaders = require('mixmap-georender')
var geotext = require('mixmap-georender/text')
var planner = require('viewbox-query-planner')
var getImagePixels = require('get-image-pixels')
var bboxIntersect = require('bbox-intersect')
 
module.exports = P
function P(opts) {
  var self = this
  if (!(self instanceof P)) return new P(opts)
  self._map = opts.map
  self._db = opts.db
  self._stylePixels = getImagePixels(opts.style),
  self._styleTexture = self._map.regl.texture(opts.style)
  var geoRender = shaders(self._map)
  self.draw = {
    area: self._map.createDraw(geoRender.areas),
    lineStroke: self._map.createDraw(geoRender.lineStroke),
    lineFill: self._map.createDraw(geoRender.lineFill),
    lineStrokeT: self._map.createDraw(geoRender.lineStroke),
    lineFillT: self._map.createDraw(geoRender.lineFill),
    point: self._map.createDraw(geoRender.points),
    pointT: self._map.createDraw(geoRender.points),
    label: self._map.createDraw(geoRender.labels),
  }
  self._zoom = -1
  self._geodata = null
  self._geotext = geotext()
  self.layer = self._map.addLayer({
    viewbox: function (bbox, zoom, cb) {
      //var start = performance.now()
      // cull boxes that no longer overlap
      var culling = 0
      for (var i = 0; i < self._buffers.length; i++) {
        var b = self._buffers[i]
        if (!bboxIntersect(bbox, b.bbox)) {
          culling++
          if (self._queryOpen[b.index]) {
            self._queryCanceled[b.index] = true
            delete self._queryOpen[b.index]
          }
          self._plan.subtract(b.bbox)
          self._bufferSize -= b.buffers.length
          self._buffers[i] = null
        }
      }
      if (culling > 0) {
        self._buffers = self._buffers.filter(function (b) { return b !== null })
      }
      // add new boxes
      var boxes = self._plan.update(bbox)
      for (var i = 0; i < boxes.length; i++) {
        self._plan.add(boxes[i])
      }
      boxes.forEach(bbox => {
        self._db.query(bbox)
          .then(q => self._loadQuery(bbox, q))
          .catch(e => self._error(e))
      })
      //console.log(`viewbox in ${performance.now()-start} ms`)
      if (self._zoom !== zoom) self._update(zoom)
      self._zoom = zoom
    },
  })
  self._plan = planner()
  self._buffers = []
  self._bufferSize = 0
  self._lastQueryIndex = -1
  self._queryCanceled = {}
  self._queryOpen = {}
  self._recalcTimer = null
  self._recalcTime = 0
  self.props = {}
}

P.prototype._error = function (err) {
  console.error('CAUGHT', err)
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
  var row, buffers = []
  var index = ++self._lastQueryIndex
  self._queryOpen[index] = true
  self._buffers.push({ bbox, buffers, index })
  while (row = await q.next()) {
    if (self._queryCanceled[index]) return
    buffers.push(Buffer.from(row[1]))
    self._bufferSize++
    self._scheduleRecalc()
  }
  delete self._queryOpen[index]
  self._recalc()
}

P.prototype._recalc = function() {
  var start = performance.now()
  // todo: compare all-in-one props against pushing more props
  var buffers = new Array(this._bufferSize)
  for (var i = 0, j = 0; i < this._buffers.length; i++) {
    var bs = this._buffers[i].buffers
    for (var k = 0; k < bs.length; k++) {
      buffers[j++] = bs[k]
    }
  }
  // todo: cache the decode and recombine?
  var zoom = Math.round(this._map.getZoom())
  this._geodata = prepare({
    stylePixels: this._stylePixels,
    styleTexture: this._styleTexture,
    decoded: decode(buffers),
  })
  this._update(zoom)
  this._recalcTime = performance.now() - start
}

P.prototype._update = function(zoom) {
  if (!this._geodata) return
  var props = this._geodata.update(zoom)
  //setProps(this.draw.point.props, props.pointP)
  //setProps(this.draw.pointT.props, props.pointT)
  setProps(this.draw.lineFill.props, props.lineP)
  setProps(this.draw.lineStroke.props, props.lineP)
  setProps(this.draw.lineFillT.props, props.lineT)
  setProps(this.draw.lineStrokeT.props, props.lineT)
  setProps(this.draw.area.props, props.area)
  setProps(this.draw.label.props, this._geotext.update(props, this._map))
  this._map.draw()
}

function setProps(dst, src) {
  if (dst.length === 0) dst.push({})
  Object.assign(dst[0],src)
}

P.prototype.pick = function (opts, cb) {
  var self = this
  if (!cb) cb = noop
  map.pick(opts, function (err, data) {
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
