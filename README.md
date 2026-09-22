# Leaflet.ZIndexManager

A Leaflet control that provides a drag-and-drop GUI panel for inspecting and managing the z-index stacking order of map panes and the layers within them.

[![Leaflet 1.x](https://img.shields.io/badge/Leaflet-1.x-green)](https://leafletjs.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

## Demo

[Live demo](https://ericdalnas.github.io/leaflet.zindexmanager/examples/)

---

## Features

- Lists all map panes sorted by CSS z-index (frontmost at the top)
- Shows each layer under its parent pane with type and z-index badges
- **Drag pane rows** to reorder panes; z-index values are redistributed automatically while preserving the numeric range
- **Drag layer rows** to reorder layers within a pane (only `GridLayer` / `TileLayer` are draggable by default)
  - `GridLayer` / `TileLayer`: reassigns `zIndex` option values
  - `Marker`: adjusts `zIndexOffset` values
  - `Path` (Polyline, Polygon, Circle …) and `ImageOverlay`: reordered via DOM position
  - Move-to-front/send-to-back ▲▼ buttons are hidden by default; enable them with the `enableMoveToFrontSendToBack` option
- Fires `panereorder` and `layerreorder` events on the map for integration with other code
- Reacts live to `layeradd` / `layerremove` events
- Supports custom panes created with `map.createPane()`
- No external dependencies beyond Leaflet

---

## Requirements

| Dependency | Version |
|------------|---------|
| Leaflet    | ≥ 1.0   |
| Browser    | Any modern browser with HTML5 Drag and Drop support (Chrome, Firefox, Safari, Edge) |

---

## Installation

### CDN

```html
<link  rel="stylesheet" href="https://unpkg.com/leaflet.zindexmanager/dist/L.Control.ZIndexManager.css" />
<script src="https://unpkg.com/leaflet.zindexmanager/dist/L.Control.ZIndexManager.js"></script>
```

### npm

```bash
npm install leaflet.zindexmanager
```

```js
import 'leaflet.zindexmanager/dist/L.Control.ZIndexManager.css';
import 'leaflet.zindexmanager';
```

### Manual

Download `dist/L.Control.ZIndexManager.js` and `dist/L.Control.ZIndexManager.css` and include them after Leaflet:

```html
<link  rel="stylesheet" href="L.Control.ZIndexManager.css" />
<script src="L.Control.ZIndexManager.js"></script>
```

---

## Quick start

```js
// Create a map
var map = L.map('map').setView([51.505, -0.09], 13);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Add the Z-Index Manager
L.control.zIndexManager().addTo(map);
```

Click the **☰ stack icon** in the top-right to open the panel.

---

## API reference

### Factory

```js
L.control.zIndexManager(options)
```

Equivalent to `new L.Control.ZIndexManager(options)`.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `position` | `String` | `'topright'` | Leaflet control position (`'topleft'`, `'topright'`, `'bottomleft'`, `'bottomright'`) |
| `collapsed` | `Boolean` | `true` | Whether the panel starts collapsed |
| `title` | `String` | `'Layer Z-Index Manager'` | Panel heading and toggle-button tooltip |
| `excludePanes` | `Array<String>` | `['mapPane']` | Pane names to hide from the panel |
| `layerNameFn` | `Function\|null` | `null` | Custom function `fn(layer) => string` for labelling layers |
| `enableMoveToFrontSendToBack` | `Boolean` | `false` | Show ▲▼ buttons to move a layer to the front/back of its pane |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `addTo(map)` | `this` | Adds the control to the map (standard Leaflet) |
| `remove()` | `this` | Removes the control from the map |

### Events

The following events are fired on the **map** object:

| Event | Data | Description |
|-------|------|-------------|
| `panereorder` | `{ order: String[] }` | Fired after panes are reordered. `order` is the new pane-name array from front to back. |
| `layerreorder` | `{ layer, target, paneName, insertBefore }` | Fired after a layer is moved. `layer` is the moved layer, `target` is the reference layer, `insertBefore` is `true`/`false`. |

```js
map.on('panereorder', function (e) {
    console.log('New pane order:', e.order);
});

map.on('layerreorder', function (e) {
    console.log(e.layer, 'moved in', e.paneName);
});
```

### Naming your layers

The panel uses the following order of preference when labelling a layer:

1. `layer.options.name`
2. `layer.options.label`
3. `layer.options.title`
4. `layer.options.attribution` (stripped of HTML)
5. TileLayer URL host fragment
6. `'Layer #<id>'` (fallback)

Override entirely with the `layerNameFn` option:

```js
L.control.zIndexManager({
    layerNameFn: function (layer) {
        return layer.myCustomProperty || 'unnamed';
    }
}).addTo(map);
```

### Custom panes

Custom panes created with `map.createPane()` appear automatically in the panel:

```js
map.createPane('labelsPane');
map.getPane('labelsPane').style.zIndex = 450;

L.tileLayer('...', { pane: 'labelsPane', name: 'Labels' }).addTo(map);

L.control.zIndexManager().addTo(map);
// "labelsPane" will appear in the panel between overlayPane (400) and markerPane (600)
```

---

## Default Leaflet pane z-indices

| Pane | Default z-index |
|------|-----------------|
| `tilePane` | 200 |
| `overlayPane` | 400 |
| `shadowPane` | 500 |
| `markerPane` | 600 |
| `tooltipPane` | 650 |
| `popupPane` | 700 |

---

## Development

```bash
# Clone
git clone https://github.com/ericdalnas/leaflet.zindexmanager.git
cd leaflet.zindexmanager

# Install dev dependencies
npm install

# Serve examples locally (any static server works)
npx serve .
# then open http://localhost:3000/examples/
```

Source files live in `src/`. The `dist/` folder contains copies ready for CDN/npm distribution. A build step (minification) is left to a future CI pipeline.

---

## Contributing

Issues and pull requests are welcome. Please open an issue before submitting large changes.

---

## License

[MIT](LICENSE) © 2026 Eric Dalnas
