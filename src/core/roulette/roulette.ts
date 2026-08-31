import type { SeededRng, RngSnapshot } from "../rng/seeded";
import type { GunState, TriggerResult } from "./types";

export const DEFAULT_GUN_CAPACITY = 6;

export function createGun(capacity = DEFAULT_GUN_CAPACITY): GunState {
  if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new RangeError("Gun capacity must be a positive integer");
  return { capacity, bullets: 0 };
}

export function addBullets(gun: GunState, amount: number): GunState {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("Bullet amount must be a non-negative integer");
  return { ...gun, bullets: Math.min(gun.capacity, gun.bullets + amount) };
}

export function removeBullets(gun: GunState, amount: number): GunState {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("Bullet amount must be a non-negative integer");
  return { ...gun, bullets: Math.max(0, gun.bullets - amount) };
}

export function deathProbability(gun: GunState): number {
  return gun.capacity === 0 ? 0 : gun.bullets / gun.capacity;
}

export function pullTrigger(gun: GunState, rng: SeededRng): { result: TriggerResult; rng: RngSnapshot } {
  const probability = deathProbability(gun);
  const roll = rng.next();
  return {
    result: { fired: roll < probability, probability, gun },
    rng: rng.snapshot()
  };
}
