// Wire-format typedefs mirroring server/types.ts. Pure JSDoc — emits no
// runtime code. Update both sides together when the wire format changes.

/**
 * @typedef {Object} Vehicle
 * @property {string} id           Stable per tram, `${operator}/${vehicle}`.
 * @property {string} line         Human-facing line label, e.g. "4", "9", "6T".
 * @property {string} routeId      GraphQL-ready id, e.g. "HSL:1004".
 * @property {1|2}    directionId  1 or 2, from HFP topic.
 * @property {number} lat
 * @property {number} lon
 * @property {number} heading      Degrees 0–359; 0 = north.
 * @property {number} updatedAt    ms since epoch when last update received.
 */

/**
 * @typedef {Object} SnapshotEvent
 * @property {Vehicle[]} vehicles
 */

/**
 * @typedef {Object} UpdateEvent
 * @property {Vehicle} vehicle
 */

/**
 * @typedef {Object} RemoveEvent
 * @property {string} id
 */

/**
 * @typedef {Object} TramStop
 * @property {string} id    e.g. "HSL:1234567"
 * @property {string} name
 * @property {number} lat
 * @property {number} lon
 * @property {string} code  Public stop code, e.g. "0501".
 */

/**
 * @typedef {Object} Departure
 * @property {string} line          Route shortName, e.g. "4".
 * @property {number} departureAt   Absolute epoch ms.
 */

export {};
