/**
 * lod.test.js — LOD Tier Calculation Unit Tests
 *
 * Tests the LOD tier determination logic: distance-based tier selection,
 * hysteresis band to prevent flickering, and custom threshold support.
 *
 * @see 08-Testing-Spec.md §1.3 — Test matrix
 * @see 06-Performance-Spec.md §4  — LOD thresholds
 * @see 02-TSD.md §8              — LOD algorithm
 */

// ─── LOD Tier Enum ──────────────────────────────────────────────────────

const LOD = Object.freeze({ FULL: 0, MID: 1, DOT: 2, CULLED: 3 });

/** Hysteresis band half-width (units). */
const HYSTERESIS = 0.5;

// ═════════════════════════════════════════════════════════════════════════
//  LOD CALCULATOR
// ═════════════════════════════════════════════════════════════════════════

/**
 * Determine the LOD tier for a node at a given distance from the camera.
 *
 * @param {number} dist   — Camera-to-node distance
 * @param {number} prev   — Previous LOD tier (for hysteresis)
 * @param {object} config — { lodNear, lodMid, lodFar }
 * @returns {number} LOD tier
 */
function getLODTier(dist, prev, config) {
  const { lodNear, lodMid, lodFar } = config;

  if      (dist < lodNear)                           return LOD.FULL;
  else if (dist < lodNear + HYSTERESIS && prev === LOD.FULL) return LOD.FULL;
  else if (dist < lodMid)                            return LOD.MID;
  else if (dist < lodMid + HYSTERESIS && prev === LOD.MID) return LOD.MID;
  else if (dist < lodFar)                            return LOD.DOT;
  else if (dist < lodFar + HYSTERESIS && prev === LOD.DOT) return LOD.DOT;
  else                                                return LOD.CULLED;
}

// ═════════════════════════════════════════════════════════════════════════
//  TESTS
// ═════════════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG = { lodNear: 5, lodMid: 15, lodFar: 30 };

describe('LOD Tier Calculation (§4)', () => {
  test('full_lod_at_near_range — 2.0 units → FULL', () => {
    expect(getLODTier(2.0, LOD.MID, DEFAULT_CONFIG)).toBe(LOD.FULL);
  });

  test('full_lod_just_below_near — 4.9 units → FULL', () => {
    expect(getLODTier(4.9, LOD.MID, DEFAULT_CONFIG)).toBe(LOD.FULL);
  });

  test('full_lod_at_threshold — 5.0 units → MID (not FULL, not in hysteresis)', () => {
    // At exactly lodNear, with prev !== FULL, it goes to MID
    expect(getLODTier(5.0, LOD.MID, DEFAULT_CONFIG)).toBe(LOD.MID);
  });

  test('mid_lod_at_mid_range — 10.0 units → MID', () => {
    expect(getLODTier(10.0, LOD.FULL, DEFAULT_CONFIG)).toBe(LOD.MID);
  });

  test('mid_lod_just_below_mid — 14.9 units → MID', () => {
    expect(getLODTier(14.9, LOD.FULL, DEFAULT_CONFIG)).toBe(LOD.MID);
  });

  test('dot_lod_at_far_range — 20.0 units → DOT', () => {
    expect(getLODTier(20.0, LOD.MID, DEFAULT_CONFIG)).toBe(LOD.DOT);
  });

  test('dot_lod_just_below_far — 29.9 units → DOT', () => {
    expect(getLODTier(29.9, LOD.MID, DEFAULT_CONFIG)).toBe(LOD.DOT);
  });

  test('culled_at_very_far — 35.0 units → CULLED', () => {
    expect(getLODTier(35.0, LOD.DOT, DEFAULT_CONFIG)).toBe(LOD.CULLED);
  });

  test('culled_beyond_far_nohyst — 30.5 units → CULLED (no hysteresis without prev=DOT)', () => {
    expect(getLODTier(30.5, LOD.MID, DEFAULT_CONFIG)).toBe(LOD.CULLED);
  });
});

describe('Hysteresis (02-TSD.md §8.1)', () => {
  test('hysteresis_prevents_flip — 5.3 units from FULL → FULL (stays in band)', () => {
    expect(getLODTier(5.3, LOD.FULL, DEFAULT_CONFIG)).toBe(LOD.FULL);
  });

  test('hysteresis_allows_transition — 5.6 units from FULL → MID (exits band)', () => {
    expect(getLODTier(5.6, LOD.FULL, DEFAULT_CONFIG)).toBe(LOD.MID);
  });

  test('hysteresis_mid_dot_band — 15.3 units from MID → MID (stays)', () => {
    expect(getLODTier(15.3, LOD.MID, DEFAULT_CONFIG)).toBe(LOD.MID);
  });

  test('hysteresis_mid_dot_transition — 15.6 units from MID → DOT (exits)', () => {
    expect(getLODTier(15.6, LOD.MID, DEFAULT_CONFIG)).toBe(LOD.DOT);
  });

  test('hysteresis_dot_culled_band — 30.3 units from DOT → DOT (stays)', () => {
    expect(getLODTier(30.3, LOD.DOT, DEFAULT_CONFIG)).toBe(LOD.DOT);
  });

  test('hysteresis_dot_culled_transition — 30.6 units from DOT → CULLED (exits)', () => {
    expect(getLODTier(30.6, LOD.DOT, DEFAULT_CONFIG)).toBe(LOD.CULLED);
  });

  test('no_hysteresis_for_upgrade — 4.5 units from CULLED → FULL (immediate)', () => {
    // When moving closer, no hysteresis stall — upgrade immediately
    expect(getLODTier(4.5, LOD.CULLED, DEFAULT_CONFIG)).toBe(LOD.FULL);
  });

  test('hysteresis_exact_threshold_edge — 5.5 units from FULL → MID (strict less-than)', () => {
    expect(getLODTier(5.5, LOD.FULL, DEFAULT_CONFIG)).toBe(LOD.MID);
  });
});

describe('Custom Thresholds', () => {
  const CUSTOM_CONFIG = { lodNear: 3, lodMid: 10, lodFar: 25 };

  test('custom_thresholds_respected — 4 units with lodNear=3 → MID', () => {
    expect(getLODTier(4, LOD.FULL, CUSTOM_CONFIG)).toBe(LOD.MID);
  });

  test('custom_near_tight — 2.5 units with lodNear=3 → FULL', () => {
    expect(getLODTier(2.5, LOD.MID, CUSTOM_CONFIG)).toBe(LOD.FULL);
  });

  test('custom_mid_tight — 9 units with lodMid=10 → MID', () => {
    expect(getLODTier(9, LOD.FULL, CUSTOM_CONFIG)).toBe(LOD.MID);
  });

  test('custom_far_tight — 24 units with lodFar=25 → DOT', () => {
    expect(getLODTier(24, LOD.MID, CUSTOM_CONFIG)).toBe(LOD.DOT);
  });

  test('custom_hysteresis_band — 3.4 from FULL with lodNear=3 → FULL', () => {
    expect(getLODTier(3.4, LOD.FULL, CUSTOM_CONFIG)).toBe(LOD.FULL);
  });

  test('custom_hysteresis_transition — 3.6 from FULL with lodNear=3 → MID', () => {
    expect(getLODTier(3.6, LOD.FULL, CUSTOM_CONFIG)).toBe(LOD.MID);
  });
});

describe('Edge Cases', () => {
  test('distance_zero — camera at node → FULL', () => {
    expect(getLODTier(0, LOD.CULLED, DEFAULT_CONFIG)).toBe(LOD.FULL);
  });

  test('distance_negative — below zero → FULL', () => {
    expect(getLODTier(-1, LOD.CULLED, DEFAULT_CONFIG)).toBe(LOD.FULL);
  });

  test('distance_huge — 1000 units → CULLED', () => {
    expect(getLODTier(1000, LOD.DOT, DEFAULT_CONFIG)).toBe(LOD.CULLED);
  });

  test('distance_exactly_far — 30.0 units, prev=DOT → DOT (hysteresis)', () => {
    expect(getLODTier(30.0, LOD.DOT, DEFAULT_CONFIG)).toBe(LOD.DOT);
  });

  test('distance_exactly_far_not_dot — 30.0 units, prev=MID → CULLED (no hysteresis)', () => {
    expect(getLODTier(30.0, LOD.MID, DEFAULT_CONFIG)).toBe(LOD.CULLED);
  });

  test('all_tiers_strict_order — verify monotonicity', () => {
    const distances = [0, 4, 5, 7, 14, 15, 17, 29, 30, 35];
    const prevs = [LOD.FULL, LOD.FULL, LOD.FULL, LOD.MID, LOD.MID, LOD.MID, LOD.DOT, LOD.DOT, LOD.DOT, LOD.CULLED];
    // dist=5,prev=FULL: 5<5=F, 5<5.5&&FULL=T → FULL (hysteresis keeps at FULL)
    // dist=15,prev=MID: 15<15=F, 15<15.5&&MID=T → MID (hysteresis keeps at MID)
    // dist=17,prev=DOT: 17<15=F, 17<15.5=F, 17<30=T → DOT
    // dist=30,prev=DOT: 30<30=F, 30<30.5&&DOT=T → DOT (hysteresis)
    const expected = [LOD.FULL, LOD.FULL, LOD.FULL, LOD.MID, LOD.MID, LOD.MID, LOD.DOT, LOD.DOT, LOD.DOT, LOD.CULLED];

    for (let i = 0; i < distances.length; i++) {
      expect(getLODTier(distances[i], prevs[i], DEFAULT_CONFIG)).toBe(expected[i]);
    }
  });
});
