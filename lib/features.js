var decode = require('georender-pack/decode')
var ConcurrentWorker = require('./concurrent-worker')
var decodeWorker = require('./feature-decode-worker')

module.exports = Features

function Features(opts) {
  if (!(this instanceof Features)) return new Features(opts)
  var self = this
  this._count = new Map
  this._buffers = new Map
  this._decoded = new Map
  this._queryIndexIds = new Map

  if (!opts) opts = {}
  if (!opts.decoder) opts.decoder = {}
  if (typeof opts.decoder.onItem !== 'function') opts.decoder.onItem = noop

  this.decoder = ConcurrentWorker(decodeWorker, {
    count: 4,
    itemId: function (row) {
      return `${row.queryIndex}-${row.rowCount}`
    },
    onItem: function (row) {
      self.addBufferDecoded(row)
      // TODO this is an ugly way to pass this through
      // can we just have the parent do its own onItem processing?
      opts.decoder.onItem()
    },
  })
}

Features.prototype.addBufferDecoded = function ({ queryIndex, buffer, decoded }) {
  var id = getId(decoded)
  // can not yet handle multiple ids with separate geometry
  if (this._decoded.has(id)) {
    var buffers = this._buffers.get(id)
    var exists = false
    for (var i = 0; i < buffers.length; i++) {
      if (Buffer.compare(buffer, buffers[i]) === 0) {
        exists = true
        break
      }
    }
    if (exists === false) {
      this._decoded.get(id).push(decoded)
      buffers.push(buffer) 
    }
  } else {
    this._decoded.set(id, [decoded])
    this._buffers.set(id, [buffer])
  }
  this._count.set(id, (this._count.get(id) || 0) + 1)
  if (this._queryIndexIds.has(queryIndex)) {
    this._queryIndexIds.get(queryIndex).push(id)
  } else {
    this._queryIndexIds.set(queryIndex, [id])
  }
}

Features.prototype.addBuffer = function (queryIndex, buffer) {
  var d = decode([buffer])
  var id = getId(d)
  // can not yet handle multiple ids with separate geometry
  if (this._decoded.has(id)) {
    var buffers = this._buffers.get(id)
    var exists = false
    for (var i = 0; i < buffers.length; i++) {
      if (Buffer.compare(buffer, buffers[i]) === 0) {
        exists = true
        break
      }
    }
    if (exists === false) {
      this._decoded.get(id).push(d)
      buffers.push(buffer) 
    }
  } else {
    this._decoded.set(id, [d])
    this._buffers.set(id, [buffer])
  }
  this._count.set(id, (this._count.get(id) || 0) + 1)
  if (this._queryIndexIds.has(queryIndex)) {
    this._queryIndexIds.get(queryIndex).push(id)
  } else {
    this._queryIndexIds.set(queryIndex, [id])
  }
}

Features.prototype._remove = function (id) {
  this._decoded.delete(id)
  this._buffers.delete(id)
}

Features.prototype.cull = function (queryIndex) {
  var ids = this._queryIndexIds.get(queryIndex)
  if (ids !== undefined) {
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i]
      var c = this._count.get(id)
      if (c <= 1) {
        this._remove(id)
        this._count.delete(id)
      } else {
        this._count.set(id, c-1)
      }
    }
  }
  this._queryIndexIds.delete(queryIndex)
}

Features.prototype.getDecoded = function () {
  var decoded = []
  for (var [id,ds] of this._decoded) {
    for (var i = 0; i < ds.length; i++) {
      decoded.push(ds[i])
    }
  }
  return mergeDecoded(decoded)
}

function mergeDecoded(mdecoded) {
  var pointSize = 0, lineSize = 0, areaSize = 0, areaCellSize = 0, areaBorderSize = 0
  for (var i = 0; i < mdecoded.length; i++) {
    var d = mdecoded[i]
    pointSize += d.point.types.length
    lineSize += d.line.types.length
    areaSize += d.area.types.length
    areaCellSize += d.area.cells.length
    areaBorderSize += d.areaBorder.types.length
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
  for (var i = 0; i < mdecoded.length; i++) {
    var d = mdecoded[i]
    for (var k = 0; k < d.point.types.length; k++) {
      decoded.point.ids[pointOffset] = d.point.ids[k]
      decoded.point.types[pointOffset] = d.point.types[k]
      decoded.point.positions[pointOffset*2+0] = d.point.positions[k*2+0]
      decoded.point.positions[pointOffset*2+1] = d.point.positions[k*2+1]
      pointOffset++
    }
    Object.assign(decoded.point.labels, d.point.labels)
    for (var k = 0; k < d.line.types.length; k++) {
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
    for (var k = 0; k < d.area.types.length; k++) {
      decoded.area.ids[areaOffset] = d.area.ids[k]
      decoded.area.types[areaOffset] = d.area.types[k]
      decoded.area.positions[areaOffset*2+0] = d.area.positions[k*2+0]
      decoded.area.positions[areaOffset*2+1] = d.area.positions[k*2+1]
      areaOffset++
    }
    Object.assign(decoded.area.labels, d.area.labels)
    for (var k = 0; k < d.areaBorder.types.length; k++) {
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
  return decoded
}

function getId(d) {
  if (d.point.ids.length > 0) return d.point.ids[0]
  if (d.line.ids.length > 0) return d.line.ids[0]
  if (d.area.ids.length > 0) return d.area.ids[0]
  return -1
}
