export interface Vehicle {
  id: string;          // `${oper}/${veh}` — stable per tram
  line: string;        // human-facing line label, e.g. "4", "9", "6T"
  routeId: string;     // GraphQL-ready id, e.g. "HSL:1004"
  directionId: 1 | 2;  // 1 or 2, from HFP topic
  lat: number;
  lon: number;
  heading: number;     // degrees, 0–359; 0 = north
  updatedAt: number;   // Date.now() when last update received
}

export type ServerMessage =
  | { type: "snapshot"; vehicles: Vehicle[] }
  | { type: "update"; vehicle: Vehicle }
  | { type: "remove"; id: string };
