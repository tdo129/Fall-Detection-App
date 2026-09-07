// src/services/routeService.ts

export interface RouteResult {
  coordinates: [number, number][]; // [latitude, longitude] array for Leaflet
  distanceKm: number;
  durationMin: number;
  success: boolean;
  message?: string;
}

/**
 * Calculates distance between two coordinates in km using Haversine formula
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Fetches real driving route from supervisor to victim using OpenStreetMap OSRM API
 */
export async function getRouteBetweenPoints(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): Promise<RouteResult> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'FallDetectionApp/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`OSRM API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const primaryRoute = data.routes[0];
      // OSRM returns GeoJSON coordinates as [longitude, latitude]
      // Leaflet expects [latitude, longitude]
      const coordinates: [number, number][] = primaryRoute.geometry.coordinates.map(
        ([lng, lat]: [number, number]) => [lat, lng]
      );

      const distanceKm = +(primaryRoute.distance / 1000).toFixed(2);
      const durationMin = Math.max(1, Math.round(primaryRoute.duration / 60));

      return {
        coordinates,
        distanceKm,
        durationMin,
        success: true,
      };
    }

    throw new Error(data.message || 'No route found');
  } catch (error: any) {
    // Fallback: create straight-line route if offline or OSRM is unreachable
    const directDistance = +calculateHaversineDistance(
      startLat,
      startLng,
      endLat,
      endLng
    ).toFixed(2);
    // Rough estimate: 30 km/h in city
    const directDuration = Math.max(1, Math.round((directDistance / 30) * 60));

    return {
      coordinates: [
        [startLat, startLng],
        [endLat, endLng],
      ],
      distanceKm: directDistance,
      durationMin: directDuration,
      success: false,
      message: error?.message || 'Sử dụng đường thẳng thay thế',
    };
  }
}
