/*!
 * Leaflet.ZIndexManager - a drag-and-drop GUI control for managing
 * map pane z-indices and layer ordering in Leaflet maps.
 *
 * https://github.com/ericdalnas/leaflet.zindexmanager
 * (c) 2026 Eric Dalnas, MIT License
 */

(function (factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD
        define(['leaflet'], factory);
    } else if (typeof module !== 'undefined' && module.exports) {
        // CommonJS
        module.exports = factory(require('leaflet'));
    } else {
        // Global
        if (typeof window.L === 'undefined') {
            throw new Error('Leaflet must be loaded before Leaflet.ZIndexManager');
        }
        factory(window.L);
    }
}(function (L) {
    'use strict';

    /**
     * L.Control.ZIndexManager
     *
     * A Leaflet control that renders a collapsible panel listing all map panes
     * (sorted by z-index) and the layers within each pane.  Panes and layers can
     * be reordered via drag-and-drop; the underlying z-index values / DOM order
     * are updated automatically.
     *
     * Usage:
     *   L.control.zIndexManager({ position: 'topright' }).addTo(map);
     *
     * Options:
     *   position          {String}   Leaflet control position. Default: 'topright'
     *   collapsed         {Boolean}  Start collapsed. Default: true
     *   title             {String}   Panel title / toggle-button tooltip.
     *   excludePanes      {Array}    Pane names to hide. Default: ['mapPane']
     *   layerNameFn       {Function} fn(layer) => string, overrides layer labelling.
     *   enableMoveToFrontSendToBack
     *                     {Boolean}  Show move-to-front/back buttons on layer
     *                                rows. Default: false.
     *
     * Events fired on the map:
     *   'panereorder'  - { order: [paneName, ...] }
     *   'layerreorder' - { layer, target, paneName, insertBefore }
     */
    L.Control.ZIndexManager = L.Control.extend({

        options: {
            position: 'topright',
            collapsed: true,
            title: 'Layer Z-Index Manager',
            excludePanes: ['mapPane'],
            layerNameFn: null,
            enableMoveToFrontSendToBack: false
        },

        initialize: function (options) {
            L.Util.setOptions(this, options);
            // Drag state
            this._draggedPaneName = null;
            this._draggedLayerId  = null;
            this._draggedLayerPane = null;
        },

        onAdd: function (map) {
            this._map = map;

            var container = L.DomUtil.create('div', 'leaflet-control-zim leaflet-bar');
            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.disableScrollPropagation(container);

            // ----- Toggle button -----
            this._toggleBtn = L.DomUtil.create('a', 'leaflet-control-zim-toggle', container);
            this._toggleBtn.href        = '#';
            this._toggleBtn.title       = this.options.title;
            this._toggleBtn.innerHTML   = '&#9776;'; // ☰ hamburger
            this._toggleBtn.setAttribute('role', 'button');
            this._toggleBtn.setAttribute('aria-label', this.options.title);
            this._toggleBtn.setAttribute('aria-expanded', 'false');
            this._toggleBtn.setAttribute('aria-haspopup', 'true');
            L.DomEvent.on(this._toggleBtn, 'click', this._onToggle, this);

            // ----- Panel -----
            this._panel = L.DomUtil.create('div', 'leaflet-control-zim-panel', container);
            this._panel.setAttribute('role', 'region');
            this._panel.setAttribute('aria-label', this.options.title);

            // React to layer add/remove
            map.on('layeradd layerremove', this._onLayerChange, this);

            // Must assign before _open() so that L.DomUtil.addClass can find the container
            this._container = container;

            if (!this.options.collapsed) {
                this._open();
            }

            return container;
        },

        onRemove: function (map) {
            map.off('layeradd layerremove', this._onLayerChange, this);
            this._stopPaneObserver();
        },

        // ------------------------------------------------------------------
        // Panel open / close
        // ------------------------------------------------------------------

        _onLayerChange: function () {
            if (this._isOpen) {
                this._buildPanel();
            }
        },

        _onToggle: function (e) {
            L.DomEvent.stop(e);
            if (this._isOpen) {
                this._close();
            } else {
                this._open();
            }
        },

        _open: function () {
            this._isOpen = true;
            L.DomUtil.addClass(this._container, 'leaflet-control-zim-open');
            this._toggleBtn.setAttribute('aria-expanded', 'true');
            this._buildPanel();
        },

        _close: function () {
            this._isOpen = false;
            L.DomUtil.removeClass(this._container, 'leaflet-control-zim-open');
            this._toggleBtn.setAttribute('aria-expanded', 'false');
            this._stopPaneObserver();
        },

        /**
         * Watches every pane element's `style` attribute so the panel stays in
         * sync if code outside this control changes a pane's z-index directly.
         * Re-armed on every rebuild so newly-created panes get observed too.
         */
        _watchPanesForChanges: function () {
            if (typeof MutationObserver === 'undefined') { return; }
            this._stopPaneObserver();

            var self  = this;
            var panes = this._map.getPanes();

            this._paneObserver = new MutationObserver(function () {
                if (self._isOpen) { self._buildPanel(); }
            });

            for (var name in panes) {
                if (panes.hasOwnProperty(name) && panes[name]) {
                    this._paneObserver.observe(panes[name], { attributes: true, attributeFilter: ['style'] });
                }
            }
        },

        _stopPaneObserver: function () {
            if (this._paneObserver) {
                this._paneObserver.disconnect();
                this._paneObserver = null;
            }
        },

        // ------------------------------------------------------------------
        // Data helpers
        // ------------------------------------------------------------------

        /**
         * Returns an array of pane descriptors sorted by z-index descending
         * (highest z-index = visually frontmost = top of list).
         */
        _getPanesData: function () {
            var panes   = this._map.getPanes();
            var exclude = this.options.excludePanes || [];
            var result  = [];

            for (var name in panes) {
                if (!panes.hasOwnProperty(name)) { continue; }
                if (exclude.indexOf(name) >= 0)  { continue; }
                var el = panes[name];
                if (!el) { continue; }
                result.push({ name: name, element: el, zIndex: this._getEffectiveZIndex(el) });
            }

            // Descending: front (high z) → top of list
            result.sort(function (a, b) { return b.zIndex - a.zIndex; });
            return result;
        },

        /**
         * Default Leaflet panes get their z-index from the leaflet.css stylesheet,
         * not from an inline style, so el.style.zIndex is empty until we've written
         * to it ourselves. Fall back to the computed style to read the real value.
         */
        _getEffectiveZIndex: function (el) {
            var z = parseInt(el.style.zIndex, 10);
            if (!isNaN(z)) { return z; }
            if (window.getComputedStyle) {
                z = parseInt(window.getComputedStyle(el).zIndex, 10);
                if (!isNaN(z)) { return z; }
            }
            return 0;
        },

        /**
         * Returns the pane name for a given layer.
         * Relies on layer.options.pane which Leaflet always populates via prototype defaults.
         */
        _getLayerPaneName: function (layer) {
            return (layer.options && layer.options.pane) ? layer.options.pane : 'overlayPane';
        },

        /**
         * Returns a human-readable name for a layer, preferring explicit names
         * before falling back to attribution text or a generated ID.
         */
        _getLayerName: function (layer) {
            if (this.options.layerNameFn) {
                return this.options.layerNameFn(layer);
            }
            var opts = layer.options || {};
            if (opts.name)        { return opts.name; }
            if (opts.label)       { return opts.label; }
            if (opts.title)       { return opts.title; }
            if (opts.attribution) {
                return opts.attribution.replace(/<[^>]+>/g, '').trim().slice(0, 30) || 'Layer';
            }
            // TileLayer URL fragment
            if (layer._url) {
                var parts = layer._url.split('/');
                // grab the host-like segment, e.g. "tile.openstreetmap.org"
                for (var i = 0; i < parts.length; i++) {
                    if (parts[i].indexOf('.') > -1) {
                        return parts[i].slice(0, 30);
                    }
                }
            }
            return 'Layer #' + layer._leaflet_id;
        },

        /** A short type badge label for a layer. */
        _getLayerType: function (layer) {
            if (layer instanceof L.TileLayer.WMS) { return 'wms'; }
            if (layer instanceof L.TileLayer)     { return 'tile'; }
            if (layer instanceof L.GridLayer)     { return 'grid'; }
            if (layer instanceof L.Marker)        { return 'marker'; }
            if (layer instanceof L.Polygon)       { return 'polygon'; }
            if (layer instanceof L.Polyline)      { return 'polyline'; }
            if (layer instanceof L.Circle)        { return 'circle'; }
            if (layer instanceof L.CircleMarker)  { return 'circle'; }
            if (layer instanceof L.ImageOverlay)  { return 'image'; }
            if (layer instanceof L.GeoJSON)       { return 'geojson'; }
            if (layer instanceof L.LayerGroup)    { return 'group'; }
            return 'layer';
        },

        /**
         * Returns a map { paneName → [layer, ...] }.
         * For tile layers, layers are sorted by zIndex ascending (low=bottom).
         * For DOM-ordered layers (paths, markers), order reflects current DOM position.
         */
        _getLayersByPane: function () {
            var self   = this;
            var byPane = {};

            this._map.eachLayer(function (layer) {
                if (layer instanceof L.Renderer) { return; }  // skip SVG/Canvas renderers
                var pname = self._getLayerPaneName(layer);
                if (!byPane[pname]) { byPane[pname] = []; }
                byPane[pname].push(layer);
            });

            for (var pane in byPane) {
                var list = byPane[pane];
                // Sort GridLayers by zIndex (descending = front at top of list)
                var allGrid    = list.every(function (l) { return l instanceof L.GridLayer; });
                // Sort Markers by zIndexOffset the same way, emulating their stacking order
                var allMarkers = !allGrid && list.every(function (l) { return l instanceof L.Marker; });

                if (allGrid) {
                    list.sort(function (a, b) {
                        var za = (a.options && a.options.zIndex != null) ? a.options.zIndex : 0;
                        var zb = (b.options && b.options.zIndex != null) ? b.options.zIndex : 0;
                        return zb - za; // descending: highest z = top of list
                    });
                } else if (allMarkers) {
                    list.sort(function (a, b) {
                        var za = (a.options && a.options.zIndexOffset != null) ? a.options.zIndexOffset : 0;
                        var zb = (b.options && b.options.zIndexOffset != null) ? b.options.zIndexOffset : 0;
                        return zb - za; // descending: highest offset = top of list
                    });
                } else {
                    // For DOM-ordered layers: reverse DOM order so last-painted = top of list
                    list.sort(function (a, b) {
                        var ea = a.getElement ? a.getElement() : null;
                        var eb = b.getElement ? b.getElement() : null;
                        if (ea && eb && ea.parentNode && ea.parentNode === eb.parentNode) {
                            // later in the DOM = higher in the visual stack
                            var pos = ea.compareDocumentPosition(eb);
                            // DOCUMENT_POSITION_FOLLOWING = 4 means eb comes after ea
                            return (pos & 4) ? 1 : -1;
                        }
                        return (a._leaflet_id || 0) - (b._leaflet_id || 0);
                    });
                    list.reverse(); // top of list = visually on top
                }
            }

            return byPane;
        },

        /** Collects layers in a given pane matching filterFn, in map insertion order. */
        _collectLayers: function (paneName, filterFn) {
            var self   = this;
            var result = [];
            this._map.eachLayer(function (l) {
                if (self._getLayerPaneName(l) === paneName && filterFn(l)) { result.push(l); }
            });
            return result;
        },

        /**
         * Returns { label, value, setter(v) } describing the editable stacking
         * property for a layer (zIndex for GridLayers, zIndexOffset for Markers),
         * or null if the layer has no such property.
         */
        _getLayerZField: function (layer) {
            if (layer instanceof L.GridLayer) {
                return {
                    label: 'z',
                    value: (layer.options && layer.options.zIndex != null) ? layer.options.zIndex : 0,
                    setter: function (v) {
                        layer.options.zIndex = v;
                        if (layer.setZIndex) { layer.setZIndex(v); }
                    }
                };
            }
            if (layer instanceof L.Marker) {
                return {
                    label: 'offset',
                    value: (layer.options && layer.options.zIndexOffset != null) ? layer.options.zIndexOffset : 0,
                    setter: function (v) {
                        layer.options.zIndexOffset = v;
                        if (layer.setZIndexOffset) { layer.setZIndexOffset(v); }
                    }
                };
            }
            return null;
        },

        // ------------------------------------------------------------------
        // Panel construction
        // ------------------------------------------------------------------

        _buildPanel: function () {
            var panel = this._panel;
            panel.innerHTML = '';

            // Header
            var hdr = L.DomUtil.create('div', 'zim-header', panel);
            hdr.textContent = this.options.title;

            var hint = L.DomUtil.create('p', 'zim-hint', panel);
            hint.textContent = 'Drag ⠿ to reorder panes. Use ▲▼ (or drag tile layers) to reorder layers.';

            var panesData    = this._getPanesData();
            var layersByPane = this._getLayersByPane();

            var paneList = L.DomUtil.create('ul', 'zim-pane-list', panel);

            var self = this;
            panesData.forEach(function (pane) {
                var layers = layersByPane[pane.name] || [];
                self._createPaneItem(paneList, pane, layers, panesData);
            });

            // Drop on empty list space (end-of-list)
            L.DomEvent.on(paneList, 'dragover', function (e) {
                if (self._draggedPaneName) { e.preventDefault(); }
            });

            this._watchPanesForChanges();
        },

        _createPaneItem: function (paneList, pane, layers, allPanes) {
            var self = this;

            var li = L.DomUtil.create('li', 'zim-pane-item', paneList);
            li.setAttribute('data-pane', pane.name);

            // ---- Pane row (drag source) ----
            var row = L.DomUtil.create('div', 'zim-pane-row', li);
            row.setAttribute('draggable', 'true');
            row.setAttribute('aria-label', 'Pane: ' + pane.name + ', z-index ' + pane.zIndex);

            var handle = L.DomUtil.create('span', 'zim-handle', row);
            handle.textContent = '⠿';
            handle.setAttribute('aria-hidden', 'true');

            var nameSpan = L.DomUtil.create('span', 'zim-pane-name', row);
            nameSpan.textContent = pane.name;

            var zField = L.DomUtil.create('span', 'zim-zfield zim-pane-zfield', row);
            zField.title = 'Edit CSS z-index';

            var zLabel = L.DomUtil.create('span', 'zim-zfield-label', zField);
            zLabel.textContent = 'z:';

            var zInput = L.DomUtil.create('input', 'zim-zfield-input zim-pane-zfield-input', zField);
            zInput.type  = 'number';
            zInput.value = pane.zIndex;
            zInput.setAttribute('draggable', 'false');
            zInput.setAttribute('aria-label', 'Edit z-index for ' + pane.name);

            L.DomEvent.on(zInput, 'mousedown', L.DomEvent.stopPropagation);
            L.DomEvent.on(zInput, 'click', L.DomEvent.stopPropagation);
            L.DomEvent.on(zInput, 'dragstart', L.DomEvent.stop);

            L.DomEvent.on(zInput, 'change', function () {
                var v = parseInt(zInput.value, 10);
                if (isNaN(v)) { return; }
                pane.element.style.zIndex = v;
                var panesData = self._getPanesData();
                self._map.fire('panereorder', { order: panesData.map(function (p) { return p.name; }) });
                self._buildPanel();
            });

            var countBadge = L.DomUtil.create('span', 'zim-badge zim-count-badge', row);
            countBadge.textContent = layers.length;
            countBadge.title = layers.length + ' layer(s)';

            // ---- Layer sub-list ----
            if (layers.length > 0) {
                var subList = L.DomUtil.create('ul', 'zim-layer-list', li);
                subList.setAttribute('aria-label', 'Layers in ' + pane.name);

                layers.forEach(function (layer) {
                    self._createLayerItem(subList, layer, pane.name);
                });

                // Drop zone for layers
                L.DomEvent.on(subList, 'dragover', function (e) {
                    if (self._draggedLayerId && self._draggedLayerPane === pane.name) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                });
            }

            // ---- Pane drag source events (on row) ----
            L.DomEvent.on(row, 'dragstart', function (e) {
                e.stopPropagation();
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', 'pane:' + pane.name);
                row.classList.add('zim-dragging');
                self._draggedPaneName = pane.name;
            });

            L.DomEvent.on(row, 'dragend', function () {
                row.classList.remove('zim-dragging');
                self._draggedPaneName = null;
                self._clearDropIndicators(paneList);
            });

            // ---- Pane drop target events (on li) ----
            L.DomEvent.on(li, 'dragover', function (e) {
                if (!self._draggedPaneName)                    { return; }
                if (self._draggedPaneName === pane.name)       { return; }
                e.preventDefault();
                self._clearDropIndicators(paneList);
                var rect = li.getBoundingClientRect();
                if (e.clientY < rect.top + rect.height / 2) {
                    li.classList.add('zim-drop-before');
                } else {
                    li.classList.add('zim-drop-after');
                }
            });

            L.DomEvent.on(li, 'dragleave', function (e) {
                // Only remove indicator if we're genuinely leaving this element
                if (!li.contains(e.relatedTarget)) {
                    li.classList.remove('zim-drop-before');
                    li.classList.remove('zim-drop-after');
                }
            });

            L.DomEvent.on(li, 'drop', function (e) {
                e.preventDefault();
                if (!self._draggedPaneName || self._draggedPaneName === pane.name) { return; }
                var before = li.classList.contains('zim-drop-before');
                self._clearDropIndicators(paneList);
                self._reorderPane(self._draggedPaneName, pane.name, before, allPanes);
            });
        },

        /**
         * Creates a pair of ▲/▼ buttons that call onMove(true|false) for
         * move-to-top / move-to-bottom actions. Prevents them from being
         * mistaken for drag handles or triggering row drag-and-drop.
         */
        _createMoveButtons: function (parent, onMove, kind) {
            var wrap = L.DomUtil.create('span', 'zim-move-buttons', parent);

            var topBtn = L.DomUtil.create('button', 'zim-move-btn', wrap);
            topBtn.type = 'button';
            topBtn.innerHTML = '&#9650;'; // ▲
            topBtn.title = 'Move ' + kind + ' to top (front)';
            topBtn.setAttribute('aria-label', 'Move ' + kind + ' to top');

            var bottomBtn = L.DomUtil.create('button', 'zim-move-btn', wrap);
            bottomBtn.type = 'button';
            bottomBtn.innerHTML = '&#9660;'; // ▼
            bottomBtn.title = 'Move ' + kind + ' to bottom (back)';
            bottomBtn.setAttribute('aria-label', 'Move ' + kind + ' to bottom');

            [topBtn, bottomBtn].forEach(function (btn) {
                btn.setAttribute('draggable', 'false');
                L.DomEvent.on(btn, 'mousedown', L.DomEvent.stopPropagation);
                L.DomEvent.on(btn, 'dragstart', L.DomEvent.stop);
            });

            L.DomEvent.on(topBtn, 'click', function (e) {
                L.DomEvent.stop(e);
                onMove(true);
            });
            L.DomEvent.on(bottomBtn, 'click', function (e) {
                L.DomEvent.stop(e);
                onMove(false);
            });

            return wrap;
        },

        _createLayerItem: function (subList, layer, paneName) {
            var self = this;
            var reorderable = this._isLayerReorderable(layer);
            var draggable   = reorderable && this._isLayerDraggable(layer);

            var li = L.DomUtil.create('li', 'zim-layer-item' + (draggable ? '' : ' zim-nodrag'), subList);
            li.setAttribute('draggable', draggable ? 'true' : 'false');
            li.setAttribute('data-layer-id', layer._leaflet_id);

            var handle;
            if (draggable) {
                handle = L.DomUtil.create('span', 'zim-handle', li);
                handle.textContent = '⠿';
                handle.setAttribute('aria-hidden', 'true');
            } else {
                // Keep non-draggable rows aligned with draggable ones.
                handle = L.DomUtil.create('span', 'zim-handle-spacer', li);
                handle.setAttribute('aria-hidden', 'true');
            }

            var typeBadge = L.DomUtil.create('span', 'zim-badge zim-type-badge zim-type-' + self._getLayerType(layer), li);
            typeBadge.textContent = self._getLayerType(layer);

            var nameSpan = L.DomUtil.create('span', 'zim-layer-name', li);
            nameSpan.textContent = self._getLayerName(layer);
            nameSpan.title       = self._getLayerName(layer);

            var zField = self._getLayerZField(layer);
            if (zField) {
                var zWrap = L.DomUtil.create('span', 'zim-zfield', li);
                zWrap.title = 'Edit ' + zField.label;

                var zLabel = L.DomUtil.create('span', 'zim-zfield-label', zWrap);
                zLabel.textContent = zField.label + ':';

                var zInput = L.DomUtil.create('input', 'zim-zfield-input', zWrap);
                zInput.type  = 'number';
                zInput.value = zField.value;
                zInput.setAttribute('draggable', 'false');
                zInput.setAttribute('aria-label', 'Edit ' + zField.label + ' for ' + self._getLayerName(layer));

                L.DomEvent.on(zInput, 'mousedown', L.DomEvent.stopPropagation);
                L.DomEvent.on(zInput, 'click', L.DomEvent.stopPropagation);
                L.DomEvent.on(zInput, 'dragstart', L.DomEvent.stop);

                L.DomEvent.on(zInput, 'change', function () {
                    var v = parseInt(zInput.value, 10);
                    if (isNaN(v)) { v = 0; }
                    zField.setter(v);
                    self._map.fire('layerreorder', { layer: layer, paneName: paneName });
                    self._buildPanel();
                });
            }

            if (reorderable) {
                self._createMoveButtons(li, function (toTop) {
                    self._moveLayerToEdge(layer, paneName, toTop);
                }, 'layer');
            }

            if (draggable) {
                // ---- Layer drag source ----
                L.DomEvent.on(li, 'dragstart', function (e) {
                    e.stopPropagation(); // Do not trigger pane drag
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', 'layer:' + layer._leaflet_id);
                    li.classList.add('zim-dragging');
                    self._draggedLayerId   = layer._leaflet_id;
                    self._draggedLayerPane = paneName;
                });

                L.DomEvent.on(li, 'dragend', function () {
                    li.classList.remove('zim-dragging');
                    self._draggedLayerId   = null;
                    self._draggedLayerPane = null;
                    self._clearDropIndicators(subList);
                });

                // ---- Layer drop target ----
                L.DomEvent.on(li, 'dragover', function (e) {
                    if (!self._draggedLayerId)                                { return; }
                    if (self._draggedLayerPane !== paneName)                  { return; } // cross-pane not supported
                    if (self._draggedLayerId === layer._leaflet_id)           { return; }
                    e.preventDefault();
                    e.stopPropagation(); // Prevent pane dragover from also firing
                    self._clearDropIndicators(subList);
                    var rect = li.getBoundingClientRect();
                    if (e.clientY < rect.top + rect.height / 2) {
                        li.classList.add('zim-drop-before');
                    } else {
                        li.classList.add('zim-drop-after');
                    }
                });

                L.DomEvent.on(li, 'dragleave', function (e) {
                    if (!li.contains(e.relatedTarget)) {
                        li.classList.remove('zim-drop-before');
                        li.classList.remove('zim-drop-after');
                    }
                });

                L.DomEvent.on(li, 'drop', function (e) {

                    if (!self._draggedLayerId || self._draggedLayerPane !== paneName ||
                            self._draggedLayerId === layer._leaflet_id) { return; }

                    var before = li.classList.contains('zim-drop-before');
                    self._clearDropIndicators(subList);

                    // Find dragged layer object
                    var draggedLayer = null;
                    self._map.eachLayer(function (l) {
                        if (l._leaflet_id === self._draggedLayerId) { draggedLayer = l; }
                    });

                    if (draggedLayer) {
                        e.preventDefault();
                        e.stopPropagation();
                        self._reorderLayer(draggedLayer, layer, before, paneName);
                    }
                });
            }
        },

        _clearDropIndicators: function (container) {
            if (!container) { return; }
            var els = container.querySelectorAll('.zim-drop-before, .zim-drop-after');
            for (var i = 0; i < els.length; i++) {
                els[i].classList.remove('zim-drop-before', 'zim-drop-after');
            }
        },

        // ------------------------------------------------------------------
        // Reordering logic: panes
        // ------------------------------------------------------------------

        /**
         * Moves draggedPaneName before/after targetPaneName in the visual stack
         * by redistributing the existing set of z-index values.
         *
         * E.g. if current order (desc) is [popupPane:700, markerPane:600, overlayPane:400]
         * and user drags markerPane to be after overlayPane (i.e. below it visually),
         * new desc order is [popupPane:700, overlayPane:600, markerPane:400].
         * Values {700,600,400} are preserved; only assignment changes.
         */
        _reorderPane: function (draggedPaneName, targetPaneName, insertBefore, allPanes) {
            // allPanes is already sorted descending by zIndex
            var names    = allPanes.map(function (p) { return p.name; });
            var zIndices = allPanes.map(function (p) { return p.zIndex; });

            var draggedIdx = names.indexOf(draggedPaneName);
            if (draggedIdx < 0) { return; }

            // Remove dragged from its current position
            names.splice(draggedIdx, 1);

            // Find new insertion point
            var targetIdx = names.indexOf(targetPaneName);
            if (targetIdx < 0) { return; }

            var insertIdx = insertBefore ? targetIdx : targetIdx + 1;
            names.splice(insertIdx, 0, draggedPaneName);

            this._applyPaneOrder(names, zIndices);
        },


        /**
         * Given a desired pane name order and the current set of z-index values
         * (in any order), reassigns the values so the largest goes to the first
         * name in the list, and so on. Fires 'panereorder' and rebuilds the panel.
         */
        _applyPaneOrder: function (names, zIndices) {
            var sortedZ  = zIndices.slice().sort(function (a, b) { return b - a; }); // desc
            var mapPanes = this._map.getPanes();

            for (var i = 0; i < names.length; i++) {
                var el = mapPanes[names[i]];
                if (el) { el.style.zIndex = sortedZ[i]; }
            }

            this._map.fire('panereorder', { order: names.slice() });
            this._buildPanel();
        },

        // ------------------------------------------------------------------
        // Reordering logic: layers
        // ------------------------------------------------------------------

        _reorderLayer: function (draggedLayer, targetLayer, insertBefore, paneName) {
            if (draggedLayer instanceof L.GridLayer && targetLayer instanceof L.GridLayer) {
                this._reorderGridLayers(draggedLayer, targetLayer, insertBefore, paneName);
            } else if (draggedLayer instanceof L.Marker && targetLayer instanceof L.Marker) {
                this._reorderMarkers(draggedLayer, targetLayer, insertBefore, paneName);
            } else {
                // Generic DOM-order reordering (Paths, ImageOverlays, etc.)
                this._reorderByDom(draggedLayer, targetLayer, insertBefore);
            }

            this._map.fire('layerreorder', {
                layer: draggedLayer,
                target: targetLayer,
                paneName: paneName,
                insertBefore: insertBefore
            });

            this._buildPanel();
        },

        /**
         * Moves a layer to the very front (top) or very back (bottom) of its
         * pane's stacking order, using the appropriate strategy for its type.
         */
        _moveLayerToEdge: function (layer, paneName, toTop) {
            if (layer instanceof L.GridLayer) {
                this._moveGridLayerToEdge(layer, paneName, toTop);
            } else if (layer instanceof L.Marker) {
                this._moveMarkerToEdge(layer, paneName, toTop);
            } else {
                this._moveDomLayerToEdge(layer, toTop);
            }

            this._map.fire('layerreorder', { layer: layer, paneName: paneName, toTop: toTop });
            this._buildPanel();
        },

        /**
         * Reassigns z-index-like values (zIndex or zIndexOffset) so that the
         * item order in `ids` gets the values in `zValues` sorted descending
         * (first id in the list = largest value = frontmost).
         */
        _applyStackOrder: function (ids, zValues, itemMap, setterName, optionName) {
            var sortedZ = zValues.slice().sort(function (a, b) { return b - a; }); // desc

            for (var i = 0; i < ids.length; i++) {
                var item = itemMap[ids[i]];
                if (item) {
                    item.options[optionName] = sortedZ[i];
                    if (item[setterName]) { item[setterName](sortedZ[i]); }
                }
            }
        },

        /**
         * Reorder GridLayers (TileLayers) by redistributing their zIndex values.
         */
        _reorderGridLayers: function (draggedLayer, targetLayer, insertBefore, paneName) {
            var self   = this;
            var layers = this._collectLayers(paneName, function (l) { return l instanceof L.GridLayer; });

            // Sort descending by current zIndex (matches panel display order)
            layers.sort(function (a, b) {
                var za = (a.options && a.options.zIndex != null) ? a.options.zIndex : 0;
                var zb = (b.options && b.options.zIndex != null) ? b.options.zIndex : 0;
                return zb - za;
            });

            var ids      = layers.map(function (l) { return l._leaflet_id; });
            var zIndices = layers.map(function (l) {
                return (l.options && l.options.zIndex != null) ? l.options.zIndex : 0;
            });

            var draggedIdx = ids.indexOf(draggedLayer._leaflet_id);
            if (draggedIdx < 0) { return; }
            ids.splice(draggedIdx, 1);

            var targetIdx = ids.indexOf(targetLayer._leaflet_id);
            if (targetIdx < 0) { return; }

            var insertIdx = insertBefore ? targetIdx : targetIdx + 1;
            ids.splice(insertIdx, 0, draggedLayer._leaflet_id);

            var layerMap = {};
            layers.forEach(function (l) { layerMap[l._leaflet_id] = l; });

            this._applyStackOrder(ids, zIndices, layerMap, 'setZIndex', 'zIndex');
        },

        /** Moves a GridLayer to the front or back of its pane's tile stack. */
        _moveGridLayerToEdge: function (layer, paneName, toTop) {
            var otherValues = this._collectLayers(paneName, function (l) {
                return l instanceof L.GridLayer && l !== layer;
            }).map(function (l) {
                return (l.options && l.options.zIndex != null) ? l.options.zIndex : 0;
            });

            if (otherValues.length === 0) { return; }

            var sorted = otherValues.slice().sort(function (a, b) { return a - b; });
            var newZ   = toTop ? sorted[sorted.length - 1] + 1 : sorted[0] - 1;

            layer.options.zIndex = newZ;
            if (layer.setZIndex) { layer.setZIndex(newZ); }
        },

        /**
         * Reorder Markers by adjusting their zIndexOffset so that
         * relative visual ordering matches the requested position.
         */
        _reorderMarkers: function (draggedLayer, targetLayer, insertBefore, paneName) {
            var markers = this._collectLayers(paneName, function (l) { return l instanceof L.Marker; });

            // Sort descending by current effective zIndex
            markers.sort(function (a, b) {
                var za = (a.options && a.options.zIndexOffset != null) ? a.options.zIndexOffset : 0;
                var zb = (b.options && b.options.zIndexOffset != null) ? b.options.zIndexOffset : 0;
                return zb - za;
            });

            var ids     = markers.map(function (m) { return m._leaflet_id; });
            var offsets = markers.map(function (m) {
                return (m.options && m.options.zIndexOffset != null) ? m.options.zIndexOffset : 0;
            });

            var draggedIdx = ids.indexOf(draggedLayer._leaflet_id);
            if (draggedIdx < 0) { return; }
            ids.splice(draggedIdx, 1);

            var targetIdx = ids.indexOf(targetLayer._leaflet_id);
            if (targetIdx < 0) { return; }

            var insertIdx = insertBefore ? targetIdx : targetIdx + 1;
            ids.splice(insertIdx, 0, draggedLayer._leaflet_id);

            var markerMap = {};
            markers.forEach(function (m) { markerMap[m._leaflet_id] = m; });

            this._applyStackOrder(ids, offsets, markerMap, 'setZIndexOffset', 'zIndexOffset');
        },

        /** Moves a Marker to the front or back of its pane's marker stack. */
        _moveMarkerToEdge: function (layer, paneName, toTop) {
            var otherOffsets = this._collectLayers(paneName, function (l) {
                return l instanceof L.Marker && l !== layer;
            }).map(function (m) {
                return (m.options && m.options.zIndexOffset != null) ? m.options.zIndexOffset : 0;
            });

            if (otherOffsets.length === 0) { return; }

            var sorted = otherOffsets.slice().sort(function (a, b) { return a - b; });
            var newOffset = toTop ? sorted[sorted.length - 1] + 1 : sorted[0] - 1;

            layer.options.zIndexOffset = newOffset;
            if (layer.setZIndexOffset) { layer.setZIndexOffset(newOffset); }
        },

        /**
         * Reorder by moving DOM elements within their shared parent.
         * Works for Path layers (SVG/Canvas) and ImageOverlays.
         */
        _reorderByDom: function (draggedLayer, targetLayer, insertBefore) {
            var el1 = this._getLayerElement(draggedLayer);
            var el2 = this._getLayerElement(targetLayer);

            if (!el1 || !el2) { return; }
            if (!el1.parentNode || el1.parentNode !== el2.parentNode) { return; }

            var parent = el1.parentNode;

            if (insertBefore) {
                parent.insertBefore(el1, el2);
            } else {
                var nextSib = el2.nextSibling;
                if (nextSib) {
                    parent.insertBefore(el1, nextSib);
                } else {
                    parent.appendChild(el1);
                }
            }
        },

        /** Moves a DOM-ordered layer (Path/ImageOverlay) to front or back within its parent. */
        _moveDomLayerToEdge: function (layer, toTop) {
            var el = this._getLayerElement(layer);
            if (!el || !el.parentNode) { return; }

            var parent = el.parentNode;
            if (toTop) {
                parent.appendChild(el); // last child = rendered on top
            } else {
                parent.insertBefore(el, parent.firstChild);
            }
        },

        /** Get the primary DOM element for a layer (if available). */
        _getLayerElement: function (layer) {
            if (layer.getElement) { return layer.getElement(); }
            if (layer._path)     { return layer._path; }
            if (layer._image)    { return layer._image; }
            return null;
        },

        /**
         * True if a layer can be reordered with the move-to-front/back buttons.
         * Requires enableMoveToFrontSendToBack, plus either a zIndex/zIndexOffset
         * field (GridLayers, Markers) or a single movable DOM element (Paths,
         * ImageOverlays). Composite layers such as LayerGroup, FeatureGroup and
         * GeoJSON have neither, so they never get the buttons.
         */
        _isLayerReorderable: function (layer) {
            if (!this.options.enableMoveToFrontSendToBack) { return false; }
            if (this._getLayerZField(layer)) { return true; }
            return !!this._getLayerElement(layer);
        },

        /**
         * True if a layer has a genuine `zIndex` stacking property. Only
         * GridLayers do, since their zIndex maps directly to a CSS z-index.
         * Markers (zIndexOffset) and Path/Image layers (DOM order only) don't
         * have a real z-index, so native drag-and-drop is disabled for them;
         * they can still be reordered through the move-to-top/bottom buttons.
         */
        _isLayerDraggable: function (layer) {
            return layer instanceof L.GridLayer;
        }
    });

    // Factory shorthand
    L.control.zIndexManager = function (options) {
        return new L.Control.ZIndexManager(options);
    };

    return L.Control.ZIndexManager;
}));
