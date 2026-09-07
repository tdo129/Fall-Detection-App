// src/components/LeafletMap.tsx
import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { View, StyleSheet, ActivityIndicator, StyleProp, ViewStyle, Linking, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { COLORS } from '../constants/theme';

export type MapTileType = 'dark' | 'standard' | 'satellite';

export interface LocationCoord {
  latitude: number;
  longitude: number;
}

export interface LeafletMapProps {
  latitude: number;
  longitude: number;
  isFall?: boolean;
  mapType?: MapTileType;
  zoom?: number;
  interactive?: boolean;
  supervisorLocation?: LocationCoord | null;
  routeCoordinates?: [number, number][];
  style?: StyleProp<ViewStyle>;
  onMapLoaded?: () => void;
}

export interface LeafletMapRef {
  centerOnLocation: (lat?: number, lng?: number) => void;
  centerOnSupervisor: () => void;
  fitAllBounds: () => void;
  openExternalNavigation: () => void;
}

function generateLeafletHtml(
  initialLat: number,
  initialLng: number,
  initialFall: boolean,
  initialType: MapTileType,
  interactive: boolean,
  initialZoom: number,
  initialSupervisor?: LocationCoord | null,
  initialRouteCoords?: [number, number][]
) {
  const supervisorJson = initialSupervisor ? JSON.stringify(initialSupervisor) : 'null';
  const routeCoordsJson = initialRouteCoords && initialRouteCoords.length > 0 ? JSON.stringify(initialRouteCoords) : '[]';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=${interactive ? 'yes' : 'no'}" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map { width: 100%; height: 100%; background: #F6F8FA; overflow: hidden; }
    
    /* Custom pulse marker */
    .marker-pin {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.5);
      border: 3px solid #ffffff;
      transition: all 0.3s ease;
    }
    .marker-pin.normal {
      background: linear-gradient(135deg, #0A84FF, #0056B3);
    }
    .marker-pin.fall {
      background: linear-gradient(135deg, #FF453A, #B31B12);
      animation: alertPulse 1s infinite alternate;
    }
    .marker-pin.supervisor {
      background: linear-gradient(135deg, #30D158, #1E8236);
      box-shadow: 0 4px 15px rgba(48, 209, 88, 0.4);
    }
    .pulse-ring {
      position: absolute;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      top: -11px;
      left: -11px;
      pointer-events: none;
      animation: ripple 2s infinite cubic-bezier(0.1, 0.2, 0.4, 1);
    }
    .pulse-ring.normal {
      border: 3px solid rgba(10, 132, 255, 0.7);
    }
    .pulse-ring.fall {
      border: 3px solid rgba(255, 69, 58, 0.9);
      animation: rippleFast 1s infinite cubic-bezier(0.1, 0.2, 0.4, 1);
    }
    .pulse-ring.supervisor {
      border: 3px solid rgba(48, 209, 88, 0.8);
    }
    @keyframes ripple {
      0% { transform: scale(0.6); opacity: 1; }
      100% { transform: scale(1.8); opacity: 0; }
    }
    @keyframes rippleFast {
      0% { transform: scale(0.7); opacity: 1; }
      100% { transform: scale(2.2); opacity: 0; }
    }
    @keyframes alertPulse {
      0% { transform: scale(1); box-shadow: 0 0 10px rgba(255,69,58,0.6); }
      100% { transform: scale(1.15); box-shadow: 0 0 25px rgba(255,69,58,1); }
    }
    .leaflet-control-attribution {
      font-size: 9px !important;
      background: rgba(255, 255, 255, 0.85) !important;
      color: #64748b !important;
    }
    .leaflet-control-attribution a {
      color: #0A84FF !important;
    }
    .leaflet-popup-content-wrapper {
      background: #FFFFFF !important;
      color: #111827 !important;
      border: 1px solid rgba(0,0,0,0.10) !important;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12) !important;
      border-radius: 12px !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    }
    .leaflet-popup-tip {
      background: #FFFFFF !important;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var currentLat = ${initialLat};
    var currentLng = ${initialLng};
    var isFall = ${initialFall};
    var mapType = '${initialType}';
    var supervisorData = ${supervisorJson};
    var routeData = ${routeCoordsJson};

    var map = L.map('map', {
      zoomControl: ${interactive ? 'true' : 'false'},
      attributionControl: true,
      dragging: ${interactive ? 'true' : 'false'},
      touchZoom: ${interactive ? 'true' : 'false'},
      doubleClickZoom: ${interactive ? 'true' : 'false'},
      scrollWheelZoom: ${interactive ? 'true' : 'false'},
    }).setView([currentLat, currentLng], ${initialZoom});

    var tileLayers = {
      dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
        attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
      }),
      standard: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }),
      satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: '&copy; Esri &mdash; Earthstar Geographics'
      })
    };

    var currentLayer = tileLayers[mapType] || tileLayers.dark;
    currentLayer.addTo(map);

    function createMarkerHtml(fall) {
      var pinClass = fall ? 'marker-pin fall' : 'marker-pin normal';
      var ringClass = fall ? 'pulse-ring fall' : 'pulse-ring normal';
      var icon = fall ? '🚨' : '📍';
      return '<div class="' + ringClass + '"></div><div class="' + pinClass + '">' + icon + '</div>';
    }

    function createSupervisorMarkerHtml() {
      return '<div class="pulse-ring supervisor"></div><div class="marker-pin supervisor">👤</div>';
    }

    var customIcon = L.divIcon({
      className: 'custom-leaflet-marker',
      html: createMarkerHtml(isFall),
      iconSize: [44, 44],
      iconAnchor: [22, 22],
      popupAnchor: [0, -22]
    });

    var marker = L.marker([currentLat, currentLng], { icon: customIcon }).addTo(map);
    
    // Safety circle around target position
    var circle = L.circle([currentLat, currentLng], {
      radius: 40,
      color: isFall ? '#FF453A' : '#0A84FF',
      fillColor: isFall ? '#FF453A' : '#0A84FF',
      fillOpacity: 0.15,
      weight: 2
    }).addTo(map);

    function updatePopupContent(lat, lng, fall) {
      var status = fall ? '<b style="color:#FF453A">🚨 CẢNH BÁO TÉ NGÃ!</b>' : '<b style="color:#30D158">🛡️ Thiết bị an toàn</b>';
      var content = '<div style="font-size:13px; line-height:1.4;">' +
        status + '<br/>' +
        '<span>Vĩ độ: ' + lat.toFixed(6) + '</span><br/>' +
        '<span>Kinh độ: ' + lng.toFixed(6) + '</span>' +
        '</div>';
      marker.bindPopup(content);
    }
    updatePopupContent(currentLat, currentLng, isFall);

    // Supervisor marker & routing layers
    var supervisorMarker = null;
    var routeGlow = null;
    var routeLine = null;

    function renderSupervisor(sup) {
      if (!sup || sup.latitude === undefined || sup.longitude === undefined) {
        if (supervisorMarker) {
          map.removeLayer(supervisorMarker);
          supervisorMarker = null;
        }
        return;
      }

      var supIcon = L.divIcon({
        className: 'custom-leaflet-marker',
        html: createSupervisorMarkerHtml(),
        iconSize: [44, 44],
        iconAnchor: [22, 22],
        popupAnchor: [0, -22]
      });

      if (!supervisorMarker) {
        supervisorMarker = L.marker([sup.latitude, sup.longitude], { icon: supIcon }).addTo(map);
        supervisorMarker.bindPopup('<b style="color:#30D158">👤 Bạn (Người giám sát)</b><br/>Vị trí hiện tại của điện thoại');
      } else {
        supervisorMarker.setLatLng([sup.latitude, sup.longitude]);
      }
    }

    function renderRoute(coords) {
      if (routeGlow) { map.removeLayer(routeGlow); routeGlow = null; }
      if (routeLine) { map.removeLayer(routeLine); routeLine = null; }

      if (coords && coords.length > 1) {
        // High-visibility vibrant neon route line
        routeGlow = L.polyline(coords, {
          color: '#0055FF',
          weight: 10,
          opacity: 0.5,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(map);

        routeLine = L.polyline(coords, {
          color: '#00F5FF',
          weight: 5,
          opacity: 1.0,
          dashArray: '10, 8',
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(map);

        fitAll();
      }
    }

    function fitAll() {
      var layers = [marker];
      if (supervisorMarker) layers.push(supervisorMarker);
      if (routeLine) layers.push(routeLine);

      if (layers.length > 1) {
        var group = L.featureGroup(layers);
        map.fitBounds(group.getBounds().pad(0.25), { animate: true, duration: 0.8 });
      }
    }

    if (supervisorData) renderSupervisor(supervisorData);
    if (routeData && routeData.length > 0) renderRoute(routeData);

    // Global function to update map state dynamically
    window.updateMapData = function(lat, lng, fall, type, shouldCenter) {
      currentLat = lat;
      currentLng = lng;
      isFall = fall;
      
      // Update tile layer if changed
      if (type && type !== mapType && tileLayers[type]) {
        map.removeLayer(currentLayer);
        currentLayer = tileLayers[type];
        currentLayer.addTo(map);
        mapType = type;
      }

      // Update target marker position & icon
      marker.setLatLng([lat, lng]);
      marker.setIcon(L.divIcon({
        className: 'custom-leaflet-marker',
        html: createMarkerHtml(fall),
        iconSize: [44, 44],
        iconAnchor: [22, 22],
        popupAnchor: [0, -22]
      }));

      // Update circle
      circle.setLatLng([lat, lng]);
      circle.setStyle({
        color: fall ? '#FF453A' : '#0A84FF',
        fillColor: fall ? '#FF453A' : '#0A84FF'
      });

      updatePopupContent(lat, lng, fall);

      if (shouldCenter) {
        map.panTo([lat, lng], { animate: true, duration: 0.8 });
      }
    };

    window.updateRouteAndSupervisor = function(coords, sup) {
      renderSupervisor(sup);
      renderRoute(coords);
    };

    window.centerOnMarker = function(lat, lng) {
      var targetLat = lat !== undefined ? lat : currentLat;
      var targetLng = lng !== undefined ? lng : currentLng;
      map.flyTo([targetLat, targetLng], 17, { animate: true, duration: 1.0 });
    };

    window.centerOnSupervisorMarker = function() {
      if (supervisorMarker) {
        map.flyTo(supervisorMarker.getLatLng(), 17, { animate: true, duration: 1.0 });
      }
    };

    window.fitAllBounds = fitAll;

    // Notify React Native that map is ready
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_READY' }));
    }
  </script>
</body>
</html>
  `;
}

export const LeafletMap = forwardRef<LeafletMapRef, LeafletMapProps>(({
  latitude,
  longitude,
  isFall = false,
  mapType = 'dark',
  zoom = 16,
  interactive = true,
  supervisorLocation,
  routeCoordinates,
  style,
  onMapLoaded,
}, ref) => {
  const webViewRef = useRef<any>(null);
  const isLoadedRef = useRef(false);
  const WebViewComponent = WebView as any;

  const pushMapData = () => {
    const js = `
      if (window.updateMapData) {
        window.updateMapData(${latitude}, ${longitude}, ${isFall}, '${mapType}', false);
      }
      true;
    `;
    webViewRef.current?.injectJavaScript(js);
  };

  const pushRouteData = () => {
    const coordsJson = JSON.stringify(routeCoordinates ?? []);
    const supJson = supervisorLocation ? JSON.stringify(supervisorLocation) : 'null';
    const js = `
      if (window.updateRouteAndSupervisor) {
        window.updateRouteAndSupervisor(${coordsJson}, ${supJson});
      }
      true;
    `;
    webViewRef.current?.injectJavaScript(js);
  };

  // Expose imperative methods to parent
  useImperativeHandle(ref, () => ({
    centerOnLocation: (lat?: number, lng?: number) => {
      const targetLat = lat ?? latitude;
      const targetLng = lng ?? longitude;
      webViewRef.current?.injectJavaScript(`
        if (window.centerOnMarker) {
          window.centerOnMarker(${targetLat}, ${targetLng});
        }
        true;
      `);
    },
    centerOnSupervisor: () => {
      webViewRef.current?.injectJavaScript(`
        if (window.centerOnSupervisorMarker) {
          window.centerOnSupervisorMarker();
        }
        true;
      `);
    },
    fitAllBounds: () => {
      webViewRef.current?.injectJavaScript(`
        if (window.fitAllBounds) {
          window.fitAllBounds();
        }
        true;
      `);
    },
    openExternalNavigation: () => {
      openNavigationApp(
        latitude,
        longitude,
        supervisorLocation?.latitude,
        supervisorLocation?.longitude
      );
    }
  }));

  // Update target marker dynamically
  useEffect(() => {
    pushMapData();
  }, [latitude, longitude, isFall, mapType]);

  // Update route & supervisor dynamically with multiple retries to avoid race condition
  useEffect(() => {
    pushRouteData();
    const t1 = setTimeout(pushRouteData, 400);
    const t2 = setTimeout(pushRouteData, 1000);
    const t3 = setTimeout(pushRouteData, 2000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [routeCoordinates, supervisorLocation]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_READY') {
        isLoadedRef.current = true;
        pushMapData();
        pushRouteData();
        onMapLoaded?.();
      }
    } catch {
      // Ignore parse error
    }
  };

  return (
    <View style={[styles.container, style]}>
      <WebViewComponent
        ref={webViewRef}
        originWhitelist={['*']}
        source={{
          html: generateLeafletHtml(
            latitude,
            longitude,
            isFall,
            mapType,
            interactive,
            zoom,
            supervisorLocation,
            routeCoordinates
          ),
        }}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        renderLoading={() => (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        )}
        style={styles.webview}
        scrollEnabled={interactive}
      />
    </View>
  );
});

export function openNavigationApp(
  targetLat: number,
  targetLng: number,
  originLat?: number,
  originLng?: number,
  label = 'Vị trí người thân té ngã'
) {
  let webUrl: string;

  if (originLat !== undefined && originLng !== undefined) {
    webUrl = `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${targetLat},${targetLng}&travelmode=driving`;
  } else {
    webUrl = `https://www.google.com/maps/dir/?api=1&destination=${targetLat},${targetLng}&travelmode=driving`;
  }

  const scheme = Platform.select({
    ios: originLat !== undefined
      ? `maps:?saddr=${originLat},${originLng}&daddr=${targetLat},${targetLng}`
      : `maps:0,0?q=${encodeURIComponent(label)}@${targetLat},${targetLng}`,
    android: originLat !== undefined
      ? `google.navigation:q=${targetLat},${targetLng}`
      : `geo:0,0?q=${targetLat},${targetLng}(${encodeURIComponent(label)})`,
  });

  if (scheme) {
    Linking.canOpenURL(scheme)
      .then((supported) => {
        if (supported) {
          Linking.openURL(scheme);
        } else {
          Linking.openURL(webUrl);
        }
      })
      .catch(() => Linking.openURL(webUrl));
  } else {
    Linking.openURL(webUrl);
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F6F8FA',
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: '#F6F8FA',
  },
  loadingContainer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#F6F8FA',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
});

export default LeafletMap;
