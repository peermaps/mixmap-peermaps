var decode = require('georender-pack/decode')
var prepare = require('mixmap-georender/prepare')
var shaders = require('mixmap-georender')
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
  }
  self._zoom = -1
  self._geodata = null
  self.layer = self._map.addLayer({
    viewbox: function (bbox, zoom, cb) {
      var start = performance.now()
      // cull boxes that no longer overlap
      var culling = 0
      for (var i = 0; i < self._buffers.length; i++) {
        if (bboxIntersect(bbox, self._buffers[i].bbox)) {
          culling++
          self._plan.subtract(self._buffers[i].bbox)
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
  self.props = {}
}

P.prototype._error = function (err) {
  console.error(err)
}

P.prototype._loadQuery = async function loadQuery(bbox, q) {
  var row, buffers = []
  this._buffers.push({ bbox, buffers })
  while (row = await q.next()) {
    buffers.push(Buffer.from(row[1]))
    this._bufferSize++
  }
  this._recalc()
}

P.prototype._recalc = function() {
  // todo: compare all-in-one props against pushing more props
  var buffers = new Array(this._bufferSize)
  for (var i = 0, j = 0; i < this._buffers.length; i++) {
    var bs = this._buffers[i].buffers
    for (var k = 0; k < bs.length; k++) {
      buffers[j++] = bs[k]
    }
  }
  var zoom = Math.round(this._map.getZoom())
  var start = performance.now()
  this._geodata = prepare({
    stylePixels: this._stylePixels,
    styleTexture: this._styleTexture,
    decoded: decode(buffers),
  })
  //console.log(`prepare in ${performance.now() - start} ms`)
  var start = performance.now()
  this._update(zoom)
  //console.log(`update in ${performance.now() - start} ms`)
}

P.prototype._update = function(zoom) {
  if (!this._geodata) return
  var props = this._geodata.update(zoom)
  setProps(this.draw.point.props, props.pointP)
  setProps(this.draw.pointT.props, props.pointT)
  setProps(this.draw.lineFill.props, props.lineP)
  setProps(this.draw.lineStroke.props, props.lineP)
  setProps(this.draw.lineFillT.props, props.lineT)
  setProps(this.draw.lineStrokeT.props, props.lineT)
  setProps(this.draw.area.props, props.area)
  this._map.draw()
}

function setProps(dst, src) {
  if (dst.length === 0) dst.push({})
  Object.assign(dst[0],src)
}
