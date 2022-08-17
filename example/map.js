var mixmapPeermaps = require('../')
var eyros = require('eyros/2d')
var mixmap = require('mixmap')
var regl = require('regl')
var params = new URLSearchParams(location.search)
var storage = require('../storage/http')(
  params.get('data') ?? 'https://ipfs.io/ipfs/QmVCYUK51Miz4jEjJxCq3bA6dfq5FXD6s2EYp6LjHQhGmh'
)
var fontUrl = params.get('font') ?? 'https://ipfs.io/ipfs/QmNQCPGV3XZrtNdQyMbZhSJcGisg4xCFyxeHs1tacrdETm/DejaVuSans.qbzf'

var mix = mixmap(regl, {
  extensions: [ 'oes_element_index_uint', 'oes_texture_float', 'ext_float_blend' ]
})
var map = mix.create({
  viewbox: params.get('viewbox')
    ? params.get('viewbox').split(/\s*,\s*/).map(Number)
    : [7.56, 47.55, 7.58, 47.56], // basel, switzerland
  backgroundColor: [0.82, 0.85, 0.99, 1.0],
  pickfb: { colorFormat: 'rgba', colorType: 'float32' }
})
window.map = map

var style = new Image
style.onload = function () {
  var pm = mixmapPeermaps({
    map,
    eyros,
    storage,
    wasmSource: fetch('eyros2d.wasm'),
    font: fetch(fontUrl),
    style
  })

  window.addEventListener('click', function (ev) {
    pm.pick({ x: ev.offsetX, y: ev.offsetY }, function (err, data) {
      console.log('pick', err, data)
    })
  })
}
style.src = 'style.png'

window.addEventListener('keydown', function (ev) {
  if (ev.code === 'Digit0') {
    map.setZoom(Math.min(6,Math.round(map.getZoom()+1)))
  } else if (ev.code === 'Minus') {
    map.setZoom(map.getZoom()-1)
    console.log(map.getZoom())
  } else if (ev.code === 'Equal') {
    map.setZoom(map.getZoom()+1)
    console.log(map.getZoom())
  }
})
window.addEventListener('resize', function (ev) {
  map.resize(window.innerWidth, window.innerHeight)
})

document.body.style.margin = '0px'
document.body.style.overflow = 'hidden'
document.body.appendChild(mix.render())
document.body.appendChild(map.render({ width: window.innerWidth, height: window.innerHeight }))
