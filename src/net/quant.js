// quant.js — NET quantization helpers. Positions to 1 cm, rotations as
// smallest-three quaternions (3 × int16 plus a 2-bit index for the dropped component).
//
// Why 1 cm: the stage is ~40 m across, so 1 cm is 4000 steps — far below visual
// resolution — and the value in centimetres fits a signed 16-bit integer with room to
// spare, which is what makes an entity 9 bytes on the wire instead of 20.

export const POS_QUANT = 100;          // units per metre → centimetres
export const QUAT_QUANT = 32767;        // int16 range, mapped onto [-1, 1]

/** @param {number} v metres @returns {number} centimetres */
export const posToQ = v => Math.round(v * POS_QUANT);
/** @param {number} q centimetres @returns {number} metres */
export const posFromQ = q => q / POS_QUANT;

/**
 * Smallest-three quaternion encoding. We drop the component with the smallest
 * magnitude and recover it from the unit-length constraint, so the wire is 8 bytes
 * instead of 16. The sign is canonicalized to w ≥ 0 first, otherwise q and −q would
 * encode differently and a client would slowly unwind over a match.
 *
 * @param {{x:number,y:number,z:number,w:number}} q
 * @returns {[number[], number]} `[a, b, c]` as int16 and the dropped component's index
 */
export function quatToSmallestThree(q) {
  // Normalize first: callers hand us quaternions straight out of a rotation, and the
  // reconstruction below assumes a unit quaternion.
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  const v = [q.x / n, q.y / n, q.z / n, q.w / n];
  let largest = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(v[i]) > Math.abs(v[largest])) largest = i;
  // Canonical sign: the dropped (largest) component is reconstructed as a positive
  // square root, so we flip the whole quaternion to make it positive. That makes the
  // encoding unique — without it, q and −q would encode differently and a client would
  // slowly unwind a rotation over a long match.
  if (v[largest] < 0) for (let i = 0; i < 4; i++) v[i] = -v[i];
  const order = [0, 1, 2, 3].filter(i => i !== largest);
  return [order.map(i => Math.round(v[i] * QUAT_QUANT)), largest];
}

/**
 * Inverse of {@link quatToSmallestThree}.
 * @param {number[]} a three int16 components
 * @param {number} largest index of the dropped component, 0..3
 * @returns {{x:number,y:number,z:number,w:number}}
 */
export function quatFromSmallestThree(a, largest) {
  const v = [0, 0, 0, 0];
  const order = [0, 1, 2, 3].filter(i => i !== largest);
  for (let i = 0; i < 3; i++) v[order[i]] = a[i] / QUAT_QUANT;
  // Recover the dropped component from the unit-length constraint. Sum only the three
  // components we actually received — including the dropped slot (still 0) would shrink
  // the result and quietly shorten the quaternion.
  const kept = order.reduce((s, i) => s + v[i] * v[i], 0);
  v[largest] = Math.sqrt(Math.max(0, 1 - kept));
  return { x: v[0], y: v[1], z: v[2], w: v[3] };
}

/** Euler YXZ → quaternion, without three.js, so the server can use it too. */
export function eulerToQuat(yaw, pitch = 0, roll = 0) {
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  return {
    x: sp * cy * cr + cp * sy * sr,
    y: cp * sy * cr - sp * cy * sr,
    z: cp * cy * sr - sp * sy * cr,
    w: cp * cy * cr + sp * sy * sr,
  };
}
